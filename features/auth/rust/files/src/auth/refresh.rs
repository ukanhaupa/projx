use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use validator::Validate;

use crate::auth::router::{client_ip, user_agent, AuthState};
use crate::auth::service::IssueArgs;
use crate::error::AppError;

#[derive(Deserialize, Validate)]
pub struct RefreshBody {
    #[validate(length(min = 1))]
    pub refresh_token: String,
}

pub async fn refresh(
    State(state): State<AuthState>,
    headers: HeaderMap,
    Json(body): Json<RefreshBody>,
) -> Result<Response, AppError> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let pair = state
        .sessions
        .rotate(
            &body.refresh_token,
            &IssueArgs {
                ip_address: client_ip(&headers),
                user_agent: user_agent(&headers),
            },
        )
        .await?;
    Ok((
        StatusCode::OK,
        Json(json!({
            "access_token": pair.access_token,
            "refresh_token": pair.refresh_token,
        })),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::mailer::Mailer;
    use crate::auth::models::{refresh_token, user};
    use crate::auth::password::hash_token;
    use crate::auth::service::{Signer, TokenPayload};
    use axum::body::Body;
    use axum::http::Request;
    use axum::Router;
    use chrono::{Duration, Utc};
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};
    use std::sync::Arc;
    use tower::ServiceExt;
    use uuid::Uuid;

    fn state(db: MockDatabase) -> AuthState {
        AuthState::new(
            Arc::new(db.into_connection()),
            Signer::with_secret(b"refresh-secret".to_vec()),
            Mailer::new(None),
        )
    }

    async fn call(state: AuthState, token: &str) -> Response {
        let app = Router::new()
            .route("/auth/refresh", axum::routing::post(refresh))
            .with_state(state);
        app.oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/refresh")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "refresh_token": token }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn refresh_rejects_empty_token() {
        let resp = call(state(MockDatabase::new(DatabaseBackend::Postgres)), "").await;
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn refresh_rejects_unknown_token() {
        let signer = Signer::with_secret(b"refresh-secret".to_vec());
        let token = signer
            .issue_tokens(&TokenPayload {
                sub: Uuid::new_v4(),
                sid: Uuid::new_v4(),
                email: "a@b.com".into(),
                name: "Ann".into(),
                role: "user".into(),
            })
            .await
            .unwrap()
            .refresh_token;
        let empty: Vec<refresh_token::Model> = vec![];
        let resp = call(
            state(MockDatabase::new(DatabaseBackend::Postgres).append_query_results([empty])),
            &token,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    async fn signed(signer: &Signer, uid: Uuid, sid: Uuid) -> String {
        signer
            .issue_tokens(&TokenPayload {
                sub: uid,
                sid,
                email: "a@b.com".into(),
                name: "Ann".into(),
                role: "user".into(),
            })
            .await
            .unwrap()
            .refresh_token
    }

    fn token_row(uid: Uuid, sid: Uuid, token_hash: String) -> refresh_token::Model {
        refresh_token::Model {
            id: Uuid::new_v4(),
            user_id: uid,
            session_id: sid,
            token_hash,
            ip_address: None,
            user_agent: None,
            expires_at: Utc::now() + Duration::days(1),
            revoked_at: None,
            rotated_to: None,
            replay_detected_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn ok_exec(rows_affected: u64) -> MockExecResult {
        MockExecResult {
            last_insert_id: 0,
            rows_affected,
        }
    }

    #[tokio::test]
    async fn refresh_genuine_replay_returns_401_detail() {
        let signer = Signer::with_secret(b"refresh-secret".to_vec());
        let uid = Uuid::new_v4();
        let sid = Uuid::new_v4();
        let token = signed(&signer, uid, sid).await;
        let child_id = Uuid::new_v4();
        let presented = refresh_token::Model {
            revoked_at: Some(Utc::now()),
            rotated_to: Some(child_id),
            ..token_row(uid, sid, hash_token(&token))
        };
        let advanced_child = refresh_token::Model {
            id: child_id,
            revoked_at: Some(Utc::now()),
            rotated_to: Some(Uuid::new_v4()),
            ..token_row(uid, sid, "child-hash".into())
        };
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![presented]])
            .append_query_results([vec![advanced_child]])
            .append_exec_results([ok_exec(1)])
            .append_exec_results([ok_exec(1)]);
        let resp = call(state(db), &token).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["detail"], "token_replay_detected");
    }

    #[tokio::test]
    async fn refresh_lost_rotation_grace_recovers() {
        let signer = Signer::with_secret(b"refresh-secret".to_vec());
        let uid = Uuid::new_v4();
        let sid = Uuid::new_v4();
        let token = signed(&signer, uid, sid).await;
        let child_id = Uuid::new_v4();
        let presented = refresh_token::Model {
            revoked_at: Some(Utc::now()),
            rotated_to: Some(child_id),
            ..token_row(uid, sid, hash_token(&token))
        };
        let unused_child = refresh_token::Model {
            id: child_id,
            ..token_row(uid, sid, "child-hash".into())
        };
        let user = user::Model {
            id: uid,
            email: "a@b.com".into(),
            name: "Ann".into(),
            password_hash: "h".into(),
            role: "user".into(),
            email_verified: true,
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
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: None,
        };
        let inserted = token_row(uid, sid, "inserted-hash".into());
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![presented]])
            .append_query_results([vec![unused_child]])
            .append_query_results([vec![user]])
            .append_exec_results([ok_exec(1)])
            .append_query_results([vec![inserted]])
            .append_exec_results([ok_exec(1)]);
        let resp = call(state(db), &token).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(v["access_token"].as_str().is_some_and(|s| !s.is_empty()));
        assert!(v["refresh_token"].as_str().is_some_and(|s| !s.is_empty()));
    }
}
