use axum::extract::State;
use axum::http::StatusCode;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::auth::router::AuthState;
use crate::error::AppError;

pub async fn logout(
    State(state): State<AuthState>,
    auth: AuthUser,
) -> Result<StatusCode, AppError> {
    let user_id = Uuid::parse_str(&auth.id)
        .map_err(|_| AppError::Unauthorized("authentication required".into()))?;
    match Uuid::parse_str(&auth.sid) {
        Ok(sid) => state.sessions.revoke_session(user_id, sid).await?,
        Err(_) => state.sessions.revoke_all_for_user(user_id).await?,
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::mailer::Mailer;
    use crate::auth::service::Signer;
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};
    use std::sync::Arc;

    fn state(db: MockDatabase) -> AuthState {
        AuthState::new(
            Arc::new(db.into_connection()),
            Signer::with_secret(b"logout-secret".to_vec()),
            Mailer::new(None),
        )
    }

    fn ok_exec() -> MockExecResult {
        MockExecResult {
            last_insert_id: 0,
            rows_affected: 1,
        }
    }

    #[tokio::test]
    async fn logout_revokes_named_session() {
        let auth = AuthUser {
            id: Uuid::new_v4().to_string(),
            email: "a@b.com".into(),
            role: "user".into(),
            permissions: vec![],
            sid: Uuid::new_v4().to_string(),
        };
        let st =
            state(MockDatabase::new(DatabaseBackend::Postgres).append_exec_results([ok_exec()]));
        assert_eq!(
            logout(State(st), auth).await.unwrap(),
            StatusCode::NO_CONTENT
        );
    }

    #[tokio::test]
    async fn logout_without_sid_revokes_all() {
        let auth = AuthUser {
            id: Uuid::new_v4().to_string(),
            email: "a@b.com".into(),
            role: "user".into(),
            permissions: vec![],
            sid: String::new(),
        };
        let st =
            state(MockDatabase::new(DatabaseBackend::Postgres).append_exec_results([ok_exec()]));
        assert_eq!(
            logout(State(st), auth).await.unwrap(),
            StatusCode::NO_CONTENT
        );
    }

    #[tokio::test]
    async fn logout_bad_user_id_unauthorized() {
        let auth = AuthUser {
            id: "bad".into(),
            email: "a@b.com".into(),
            role: "user".into(),
            permissions: vec![],
            sid: "s".into(),
        };
        let st = state(MockDatabase::new(DatabaseBackend::Postgres));
        let err = logout(State(st), auth).await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized(_)));
    }
}
