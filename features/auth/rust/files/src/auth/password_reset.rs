use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use chrono::{Duration, Utc};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set, TransactionTrait};
use serde::Deserialize;
use validator::Validate;

use crate::apperr::from_db;
use crate::auth::mailer::build_reset_link;
use crate::auth::models::{refresh_token, user, verification_token};
use crate::auth::password::{hash_password, hash_token, random_token};
use crate::auth::router::AuthState;
use crate::error::AppError;

const RESET_TTL_MINUTES: i64 = 30;

#[derive(Deserialize, Validate)]
pub struct RequestBody {
    #[validate(email)]
    pub email: String,
}

#[derive(Deserialize, Validate)]
pub struct ConfirmBody {
    #[validate(length(min = 1))]
    pub token: String,
    #[validate(length(min = 8))]
    pub new_password: String,
}

pub async fn request_reset(
    State(state): State<AuthState>,
    Json(body): Json<RequestBody>,
) -> Result<StatusCode, AppError> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let email = body.email.trim().to_lowercase();
    let db = state.db.as_ref();

    let user = user::Entity::find()
        .filter(user::Column::Email.eq(email))
        .one(db)
        .await
        .map_err(|e| from_db(e, "user"))?;
    let Some(user) = user else {
        return Ok(StatusCode::NO_CONTENT);
    };

    let raw = random_token()?;
    verification_token::Model::active(
        user.id,
        verification_token::KIND_PASSWORD_RESET,
        hash_token(&raw),
        Utc::now() + Duration::minutes(RESET_TTL_MINUTES),
    )
    .insert(db)
    .await
    .map_err(|e| from_db(e, "verification_token"))?;

    state
        .mailer
        .send_password_reset(&user.email, &build_reset_link(&raw))
        .await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn confirm_reset(
    State(state): State<AuthState>,
    Json(body): Json<ConfirmBody>,
) -> Result<StatusCode, AppError> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let db = state.db.as_ref();
    let hash = hash_token(&body.token);
    let now = Utc::now();

    let record = verification_token::Entity::find()
        .filter(verification_token::Column::TokenHash.eq(hash))
        .filter(verification_token::Column::Kind.eq(verification_token::KIND_PASSWORD_RESET))
        .filter(verification_token::Column::ConsumedAt.is_null())
        .filter(verification_token::Column::ExpiresAt.gt(now))
        .one(db)
        .await
        .map_err(|e| from_db(e, "verification_token"))?
        .ok_or_else(|| AppError::Validation("invalid or expired reset token".into()))?;

    let new_hash = hash_password(&body.new_password)?;
    let user_id = record.user_id;

    let target = user::Entity::find_by_id(user_id)
        .one(db)
        .await
        .map_err(|e| from_db(e, "user"))?
        .ok_or_else(|| AppError::Validation("invalid or expired reset token".into()))?;

    let txn = db.begin().await.map_err(|e| from_db(e, "user"))?;
    let mut um: user::ActiveModel = target.into();
    um.password_hash = Set(new_hash);
    um.updated_at = Set(now);
    um.update(&txn).await.map_err(|e| from_db(e, "user"))?;

    let mut rm: verification_token::ActiveModel = record.into();
    rm.consumed_at = Set(Some(now));
    rm.updated_at = Set(now);
    rm.update(&txn)
        .await
        .map_err(|e| from_db(e, "verification_token"))?;

    refresh_token::Entity::update_many()
        .col_expr(
            refresh_token::Column::RevokedAt,
            sea_orm::sea_query::Expr::value(Some(now)),
        )
        .filter(refresh_token::Column::UserId.eq(user_id))
        .filter(refresh_token::Column::RevokedAt.is_null())
        .exec(&txn)
        .await
        .map_err(|e| from_db(e, "refresh_token"))?;

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
    use uuid::Uuid;

    fn state(db: MockDatabase) -> AuthState {
        AuthState::new(
            Arc::new(db.into_connection()),
            Signer::with_secret(b"pwd-reset-secret".to_vec()),
            Mailer::new(None),
        )
    }

    fn router(state: AuthState) -> Router {
        Router::new()
            .route("/req", axum::routing::post(request_reset))
            .route("/confirm", axum::routing::post(confirm_reset))
            .with_state(state)
    }

    async fn post(state: AuthState, path: &str, body: serde_json::Value) -> StatusCode {
        router(state)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
    }

    fn user_row(email: &str) -> user::Model {
        let now = Utc::now();
        user::Model {
            id: Uuid::new_v4(),
            email: email.into(),
            name: "Ann".into(),
            password_hash: "h".into(),
            role: "user".into(),
            email_verified: true,
            email_verified_at: Some(now),
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
            kind: verification_token::KIND_PASSWORD_RESET.into(),
            token_hash: "h".into(),
            expires_at: now + Duration::hours(1),
            consumed_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn request_unknown_email_is_204() {
        let empty: Vec<user::Model> = vec![];
        let st = state(MockDatabase::new(DatabaseBackend::Postgres).append_query_results([empty]));
        assert_eq!(
            post(st, "/req", json!({"email":"ghost@b.com"})).await,
            StatusCode::NO_CONTENT
        );
    }

    #[tokio::test]
    async fn request_known_email_creates_token() {
        let u = user_row("a@b.com");
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![token_row(u.id)]]);
        assert_eq!(
            post(state(db), "/req", json!({"email":"a@b.com"})).await,
            StatusCode::NO_CONTENT
        );
    }

    #[tokio::test]
    async fn request_rejects_bad_email() {
        let st = state(MockDatabase::new(DatabaseBackend::Postgres));
        assert_eq!(
            post(st, "/req", json!({"email":"nope"})).await,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn confirm_invalid_token_422() {
        let empty: Vec<verification_token::Model> = vec![];
        let st = state(MockDatabase::new(DatabaseBackend::Postgres).append_query_results([empty]));
        assert_eq!(
            post(
                st,
                "/confirm",
                json!({"token":"x","new_password":"password123"})
            )
            .await,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn confirm_happy_path_204() {
        let u = user_row("a@b.com");
        let tok = token_row(u.id);
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![tok]])
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![token_row(u.id)]])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }]);
        assert_eq!(
            post(
                state(db),
                "/confirm",
                json!({"token":"x","new_password":"password123"})
            )
            .await,
            StatusCode::NO_CONTENT
        );
    }

    #[tokio::test]
    async fn confirm_rejects_short_password() {
        let st = state(MockDatabase::new(DatabaseBackend::Postgres));
        assert_eq!(
            post(st, "/confirm", json!({"token":"x","new_password":"short"})).await,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
}
