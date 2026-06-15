use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Utc;
use sea_orm::{ActiveModelTrait, EntityTrait, Set};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;
use validator::Validate;

use crate::apperr::from_db;
use crate::auth::mfa::{
    build_otpauth_url, decode_secret, encode_recovery_hashes, encode_secret,
    generate_recovery_codes, generate_secret, hash_recovery_codes, verify_totp,
};
use crate::auth::middleware::AuthUser;
use crate::auth::models::user;
use crate::auth::password::verify_password;
use crate::auth::router::AuthState;
use crate::auth::service::register_mfa_failure;
use crate::error::AppError;

#[derive(Deserialize, Validate)]
pub struct VerifyBody {
    #[validate(length(min = 6, max = 10))]
    pub code: String,
}

#[derive(Deserialize, Validate)]
pub struct DisableBody {
    #[validate(length(min = 1))]
    pub password: String,
}

async fn load_user(state: &AuthState, auth: &AuthUser) -> Result<user::Model, AppError> {
    let user_id = Uuid::parse_str(&auth.id)
        .map_err(|_| AppError::Unauthorized("authentication required".into()))?;
    user::Entity::find_by_id(user_id)
        .one(state.db.as_ref())
        .await
        .map_err(|e| from_db(e, "user"))?
        .ok_or_else(|| AppError::NotFound("user".into()))
}

pub async fn enroll(State(state): State<AuthState>, auth: AuthUser) -> Result<Response, AppError> {
    let u = load_user(&state, &auth).await?;
    if u.mfa_enabled {
        return Err(AppError::Conflict("MFA already enabled".into()));
    }
    let secret = generate_secret();
    let codes = generate_recovery_codes();
    let hashes = hash_recovery_codes(&codes)?;
    let enc_secret = encode_secret(&secret)?;
    let enc_hashes = encode_recovery_hashes(&hashes)?;
    let qrcode = build_otpauth_url(&u.email, &secret)?;

    let mut am: user::ActiveModel = u.into();
    am.mfa_secret_enc = Set(Some(enc_secret));
    am.mfa_recovery_codes_enc = Set(Some(enc_hashes));
    am.mfa_verified_at = Set(None);
    am.updated_at = Set(Utc::now());
    am.update(state.db.as_ref())
        .await
        .map_err(|e| from_db(e, "user"))?;

    Ok((
        StatusCode::OK,
        Json(json!({
            "secret": secret,
            "qrcode_url": qrcode,
            "recovery_codes": codes,
        })),
    )
        .into_response())
}

pub async fn verify(
    State(state): State<AuthState>,
    auth: AuthUser,
    Json(body): Json<VerifyBody>,
) -> Result<StatusCode, AppError> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let u = load_user(&state, &auth).await?;
    let Some(enc) = u.mfa_secret_enc.clone() else {
        return Err(AppError::Validation("MFA not pending enrollment".into()));
    };
    let secret = decode_secret(&enc)?;
    if !verify_totp(&body.code, &secret) {
        register_mfa_failure(state.db.as_ref(), &u).await?;
        return Err(AppError::Validation("invalid mfa code".into()));
    }
    let now = Utc::now();
    let mut am: user::ActiveModel = u.into();
    am.mfa_enabled = Set(true);
    am.mfa_verified_at = Set(Some(now));
    am.mfa_failed_count = Set(0);
    am.mfa_locked_until = Set(None);
    am.updated_at = Set(now);
    am.update(state.db.as_ref())
        .await
        .map_err(|e| from_db(e, "user"))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn disable(
    State(state): State<AuthState>,
    auth: AuthUser,
    Json(body): Json<DisableBody>,
) -> Result<StatusCode, AppError> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let u = load_user(&state, &auth).await?;
    if !u.mfa_enabled {
        return Err(AppError::Validation("MFA not enabled".into()));
    }
    if !verify_password(&body.password, &u.password_hash) {
        return Err(AppError::Validation("invalid password".into()));
    }
    let mut am: user::ActiveModel = u.into();
    am.mfa_enabled = Set(false);
    am.mfa_secret_enc = Set(None);
    am.mfa_recovery_codes_enc = Set(None);
    am.mfa_verified_at = Set(None);
    am.mfa_failed_count = Set(0);
    am.mfa_locked_until = Set(None);
    am.updated_at = Set(Utc::now());
    am.update(state.db.as_ref())
        .await
        .map_err(|e| from_db(e, "user"))?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::mailer::Mailer;
    use crate::auth::mfa::encode_secret as enc_secret;
    use crate::auth::password::hash_password;
    use crate::auth::service::Signer;
    use sea_orm::{DatabaseBackend, MockDatabase};
    use std::sync::Arc;

    fn state(db: MockDatabase) -> AuthState {
        AuthState::new(
            Arc::new(db.into_connection()),
            Signer::with_secret(b"mfa-secret".to_vec()),
            Mailer::new(None),
        )
    }

    fn auth_for(id: Uuid) -> AuthUser {
        AuthUser {
            id: id.to_string(),
            email: "a@b.com".into(),
            role: "user".into(),
            permissions: vec![],
            sid: Uuid::new_v4().to_string(),
        }
    }

    fn user_row(mfa_enabled: bool, secret: Option<&str>, password: &str) -> user::Model {
        let now = Utc::now();
        user::Model {
            id: Uuid::new_v4(),
            email: "a@b.com".into(),
            name: "Ann".into(),
            password_hash: hash_password(password).unwrap(),
            role: "user".into(),
            email_verified: true,
            email_verified_at: Some(now),
            failed_login_count: 0,
            locked_until: None,
            mfa_enabled,
            mfa_secret_enc: secret.map(|s| enc_secret(s).unwrap()),
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

    fn current_code(secret: &str) -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let bytes = base32::decode(base32::Alphabet::Rfc4648 { padding: false }, secret).unwrap();
        let totp = totp_rs::TOTP::new(totp_rs::Algorithm::SHA1, 6, 3, 30, bytes).unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        totp.generate(now)
    }

    #[tokio::test]
    async fn enroll_returns_secret_and_codes() {
        let u = user_row(false, None, "password123");
        let id = u.id;
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![u]]);
        let resp = enroll(State(state(db)), auth_for(id)).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 8192).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(v["secret"].as_str().is_some());
        assert_eq!(v["recovery_codes"].as_array().unwrap().len(), 10);
    }

    #[tokio::test]
    async fn enroll_conflicts_when_already_enabled() {
        let u = user_row(true, Some("JBSWY3DPEHPK3PXP"), "password123");
        let id = u.id;
        let db = MockDatabase::new(DatabaseBackend::Postgres).append_query_results([vec![u]]);
        let err = enroll(State(state(db)), auth_for(id)).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn verify_accepts_valid_code() {
        let secret = generate_secret();
        let u = user_row(false, Some(&secret), "password123");
        let id = u.id;
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![u]]);
        let code = current_code(&secret);
        let st = state(db);
        let out = verify(State(st), auth_for(id), Json(VerifyBody { code }))
            .await
            .unwrap();
        assert_eq!(out, StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn verify_rejects_wrong_code() {
        let secret = generate_secret();
        let u = user_row(false, Some(&secret), "password123");
        let id = u.id;
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![u]]);
        let err = verify(
            State(state(db)),
            auth_for(id),
            Json(VerifyBody {
                code: "000000".into(),
            }),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn verify_without_pending_secret_rejected() {
        let u = user_row(false, None, "password123");
        let id = u.id;
        let db = MockDatabase::new(DatabaseBackend::Postgres).append_query_results([vec![u]]);
        let err = verify(
            State(state(db)),
            auth_for(id),
            Json(VerifyBody {
                code: "123456".into(),
            }),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn disable_requires_correct_password() {
        let u = user_row(true, Some("JBSWY3DPEHPK3PXP"), "password123");
        let id = u.id;
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![u]]);
        let out = disable(
            State(state(db)),
            auth_for(id),
            Json(DisableBody {
                password: "password123".into(), // pragma: allowlist secret
            }),
        )
        .await
        .unwrap();
        assert_eq!(out, StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn disable_wrong_password_rejected() {
        let u = user_row(true, Some("JBSWY3DPEHPK3PXP"), "password123");
        let id = u.id;
        let db = MockDatabase::new(DatabaseBackend::Postgres).append_query_results([vec![u]]);
        let err = disable(
            State(state(db)),
            auth_for(id),
            Json(DisableBody {
                password: "wrong".into(), // pragma: allowlist secret
            }),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn disable_when_not_enabled_rejected() {
        let u = user_row(false, None, "password123");
        let id = u.id;
        let db = MockDatabase::new(DatabaseBackend::Postgres).append_query_results([vec![u]]);
        let err = disable(
            State(state(db)),
            auth_for(id),
            Json(DisableBody {
                password: "password123".into(), // pragma: allowlist secret
            }),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn load_user_bad_id_unauthorized() {
        let st = state(MockDatabase::new(DatabaseBackend::Postgres));
        let auth = AuthUser {
            id: "bad".into(),
            email: "a@b.com".into(),
            role: "user".into(),
            permissions: vec![],
            sid: "s".into(),
        };
        assert!(matches!(
            load_user(&st, &auth).await.unwrap_err(),
            AppError::Unauthorized(_)
        ));
    }
}
