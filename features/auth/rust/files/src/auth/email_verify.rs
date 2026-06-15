use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use chrono::{Duration, Utc};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set, TransactionTrait};
use serde::Deserialize;
use uuid::Uuid;
use validator::Validate;

use crate::apperr::from_db;
use crate::auth::mailer::build_verification_link;
use crate::auth::middleware::AuthUser;
use crate::auth::models::{user, verification_token};
use crate::auth::password::{hash_token, random_token};
use crate::auth::router::AuthState;
use crate::error::AppError;

const EMAIL_VERIFY_TTL_HOURS: i64 = 24;

#[derive(Deserialize, Validate)]
pub struct ConfirmBody {
    #[validate(length(min = 1))]
    pub token: String,
}

pub async fn request(
    State(state): State<AuthState>,
    auth: AuthUser,
) -> Result<StatusCode, AppError> {
    let user_id = Uuid::parse_str(&auth.id)
        .map_err(|_| AppError::Unauthorized("authentication required".into()))?;
    let db = state.db.as_ref();
    let u = user::Entity::find_by_id(user_id)
        .one(db)
        .await
        .map_err(|e| from_db(e, "user"))?
        .ok_or_else(|| AppError::NotFound("user".into()))?;
    if u.email_verified {
        return Ok(StatusCode::NO_CONTENT);
    }
    let raw = random_token()?;
    verification_token::Model::active(
        u.id,
        verification_token::KIND_EMAIL_VERIFY,
        hash_token(&raw),
        Utc::now() + Duration::hours(EMAIL_VERIFY_TTL_HOURS),
    )
    .insert(db)
    .await
    .map_err(|e| from_db(e, "verification_token"))?;
    state
        .mailer
        .send_verification(&u.email, &build_verification_link(&raw))
        .await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn confirm(
    State(state): State<AuthState>,
    Json(body): Json<ConfirmBody>,
) -> Result<StatusCode, AppError> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let db = state.db.as_ref();
    let now = Utc::now();
    let record = verification_token::Entity::find()
        .filter(verification_token::Column::TokenHash.eq(hash_token(&body.token)))
        .filter(verification_token::Column::Kind.eq(verification_token::KIND_EMAIL_VERIFY))
        .filter(verification_token::Column::ConsumedAt.is_null())
        .filter(verification_token::Column::ExpiresAt.gt(now))
        .one(db)
        .await
        .map_err(|e| from_db(e, "verification_token"))?
        .ok_or_else(|| AppError::Validation("invalid or expired verification token".into()))?;

    let target = user::Entity::find_by_id(record.user_id)
        .one(db)
        .await
        .map_err(|e| from_db(e, "user"))?
        .ok_or_else(|| AppError::Validation("invalid or expired verification token".into()))?;

    let txn = db.begin().await.map_err(|e| from_db(e, "user"))?;
    let mut um: user::ActiveModel = target.into();
    um.email_verified = Set(true);
    um.email_verified_at = Set(Some(now));
    um.updated_at = Set(now);
    um.update(&txn).await.map_err(|e| from_db(e, "user"))?;
    let mut rm: verification_token::ActiveModel = record.into();
    rm.consumed_at = Set(Some(now));
    rm.updated_at = Set(now);
    rm.update(&txn)
        .await
        .map_err(|e| from_db(e, "verification_token"))?;
    txn.commit().await.map_err(|e| from_db(e, "user"))?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::mailer::Mailer;
    use crate::auth::service::Signer;
    use axum::body::Body;
    use axum::http::Request;
    use axum::Router;
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};
    use serde_json::json;
    use std::sync::Arc;
    use tower::ServiceExt;

    fn state(db: MockDatabase) -> AuthState {
        AuthState::new(
            Arc::new(db.into_connection()),
            Signer::with_secret(b"email-verify-secret".to_vec()),
            Mailer::new(None),
        )
    }

    fn user_row(verified: bool) -> user::Model {
        let now = Utc::now();
        user::Model {
            id: Uuid::new_v4(),
            email: "a@b.com".into(),
            name: "Ann".into(),
            password_hash: "h".into(),
            role: "user".into(),
            email_verified: verified,
            email_verified_at: None,
            failed_login_count: 0,
            locked_until: None,
            mfa_enabled: false,
            mfa_secret_enc: None,
            mfa_recovery_codes_enc: None,
            mfa_verified_at: None,
            mfa_failed_count: 0,
            mfa_locked_until: None,
            last_login: None,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        }
    }

    fn token_row(uid: Uuid) -> verification_token::Model {
        let now = Utc::now();
        verification_token::Model {
            id: Uuid::new_v4(),
            user_id: uid,
            kind: verification_token::KIND_EMAIL_VERIFY.into(),
            token_hash: "h".into(),
            expires_at: now + Duration::hours(1),
            consumed_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    async fn confirm_post(state: AuthState, body: serde_json::Value) -> StatusCode {
        Router::new()
            .route("/c", axum::routing::post(confirm))
            .with_state(state)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/c")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
    }

    #[tokio::test]
    async fn request_already_verified_204() {
        let u = user_row(true);
        let auth = AuthUser {
            id: u.id.to_string(),
            email: "a@b.com".into(),
            role: "user".into(),
            permissions: vec![],
            sid: Uuid::new_v4().to_string(),
        };
        let st =
            state(MockDatabase::new(DatabaseBackend::Postgres).append_query_results([vec![u]]));
        assert_eq!(
            request(State(st), auth).await.unwrap(),
            StatusCode::NO_CONTENT
        );
    }

    #[tokio::test]
    async fn request_unverified_sends_and_204() {
        let u = user_row(false);
        let auth = AuthUser {
            id: u.id.to_string(),
            email: "a@b.com".into(),
            role: "user".into(),
            permissions: vec![],
            sid: Uuid::new_v4().to_string(),
        };
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![token_row(u.id)]]);
        assert_eq!(
            request(State(state(db)), auth).await.unwrap(),
            StatusCode::NO_CONTENT
        );
    }

    #[tokio::test]
    async fn request_bad_sub_unauthorized() {
        let auth = AuthUser {
            id: "not-a-uuid".into(),
            email: "a@b.com".into(),
            role: "user".into(),
            permissions: vec![],
            sid: "s".into(),
        };
        let st = state(MockDatabase::new(DatabaseBackend::Postgres));
        let err = request(State(st), auth).await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized(_)));
    }

    #[tokio::test]
    async fn confirm_invalid_token_422() {
        let empty: Vec<verification_token::Model> = vec![];
        let st = state(MockDatabase::new(DatabaseBackend::Postgres).append_query_results([empty]));
        assert_eq!(
            confirm_post(st, json!({"token":"x"})).await,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn confirm_happy_path_204() {
        let u = user_row(false);
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![token_row(u.id)]])
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![token_row(u.id)]])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }]);
        assert_eq!(
            confirm_post(state(db), json!({"token":"x"})).await,
            StatusCode::NO_CONTENT
        );
    }

    #[tokio::test]
    async fn confirm_rejects_empty_token() {
        let st = state(MockDatabase::new(DatabaseBackend::Postgres));
        assert_eq!(
            confirm_post(st, json!({"token":""})).await,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
}
