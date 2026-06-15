use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{Duration, Utc};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter};
use serde::Deserialize;
use serde_json::json;
use validator::Validate;

use crate::apperr::from_db;
use crate::auth::mailer::build_verification_link;
use crate::auth::mfa::{decode_secret, is_mfa_locked, verify_totp};
use crate::auth::models::{user, verification_token};
use crate::auth::password::{hash_password, hash_token, random_token, verify_password};
use crate::auth::router::{client_ip, user_agent, AuthState};
use crate::auth::service::{
    is_account_locked, register_failed_login, register_mfa_failure, reset_login_counters,
    reset_mfa_counters, IssueArgs,
};
use crate::error::AppError;

const EMAIL_VERIFY_TTL_HOURS: i64 = 24;

#[derive(Deserialize, Validate)]
pub struct SignupBody {
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 1))]
    pub name: String,
    #[validate(length(min = 8))]
    pub password: String,
}

#[derive(Deserialize, Validate)]
pub struct LoginBody {
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 1))]
    pub password: String,
    #[serde(default)]
    pub mfa_code: Option<String>,
}

fn too_many(detail: &str) -> Response {
    let request_id = crate::middleware::request_id::RequestId::current().unwrap_or_default();
    (
        StatusCode::TOO_MANY_REQUESTS,
        Json(json!({ "detail": detail, "request_id": request_id })),
    )
        .into_response()
}

pub async fn signup(
    State(state): State<AuthState>,
    headers: HeaderMap,
    Json(body): Json<SignupBody>,
) -> Result<Response, AppError> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let email = body.email.trim().to_lowercase();
    let db = state.db.as_ref();

    let existing = user::Entity::find()
        .filter(user::Column::Email.eq(email.clone()))
        .one(db)
        .await
        .map_err(|e| from_db(e, "user"))?;
    if existing.is_some() {
        return Err(AppError::Conflict(
            "an account with this email already exists".into(),
        ));
    }

    let hash = hash_password(&body.password)?;
    let count = user::Entity::find()
        .count(db)
        .await
        .map_err(|e| from_db(e, "user"))?;
    let role = if count == 0 { "admin" } else { "user" };

    let created = user::Model::active(email, body.name.trim().to_string(), hash, role.to_string())
        .insert(db)
        .await
        .map_err(|e| from_db(e, "user"))?;

    let pair = state
        .sessions
        .issue(
            &created,
            &IssueArgs {
                ip_address: client_ip(&headers),
                user_agent: user_agent(&headers),
            },
        )
        .await?;

    if let Ok(raw) = random_token() {
        let row = verification_token::Model::active(
            created.id,
            verification_token::KIND_EMAIL_VERIFY,
            hash_token(&raw),
            Utc::now() + Duration::hours(EMAIL_VERIFY_TTL_HOURS),
        );
        if row.insert(db).await.is_ok() {
            state
                .mailer
                .send_verification(&created.email, &build_verification_link(&raw))
                .await;
        }
    }

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "user_id": created.id.to_string(),
            "access_token": pair.access_token,
            "refresh_token": pair.refresh_token,
        })),
    )
        .into_response())
}

pub async fn login(
    State(state): State<AuthState>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> Result<Response, AppError> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let email = body.email.trim().to_lowercase();
    let db = state.db.as_ref();

    let user = user::Entity::find()
        .filter(user::Column::Email.eq(email))
        .one(db)
        .await
        .map_err(|e| from_db(e, "user"))?;
    let user = match user {
        Some(u) => u,
        None => return Err(AppError::Unauthorized("invalid credentials".into())),
    };

    if is_account_locked(&user) {
        return Ok(too_many("too many failed attempts; try again later"));
    }

    if !verify_password(&body.password, &user.password_hash) {
        register_failed_login(db, &user).await?;
        return Err(AppError::Unauthorized("invalid credentials".into()));
    }
    reset_login_counters(db, &user).await?;

    if user.mfa_enabled {
        if is_mfa_locked(user.mfa_locked_until) {
            return Ok(too_many("MFA temporarily locked"));
        }
        match body.mfa_code.as_deref().map(str::trim) {
            None | Some("") => {
                let challenge = state.signer().sign_mfa_challenge(user.id).await?;
                return Ok((
                    StatusCode::OK,
                    Json(json!({
                        "mfa_required": true,
                        "challenge_token": challenge,
                        "email": user.email,
                    })),
                )
                    .into_response());
            }
            Some(code) => {
                let secret = user
                    .mfa_secret_enc
                    .as_deref()
                    .map(decode_secret)
                    .transpose()
                    .ok()
                    .flatten();
                let ok = match secret {
                    Some(s) => verify_totp(code, &s),
                    None => false,
                };
                if !ok {
                    register_mfa_failure(db, &user).await?;
                    return Err(AppError::Unauthorized("invalid mfa code".into()));
                }
                reset_mfa_counters(db, &user).await?;
            }
        }
    }

    let pair = state
        .sessions
        .issue(
            &user,
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
    use crate::auth::service::Signer;
    use axum::body::Body;
    use axum::http::Request;
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};
    use std::sync::Arc;
    use tower::ServiceExt;
    use uuid::Uuid;

    fn count_row(n: i64) -> std::collections::BTreeMap<String, sea_orm::Value> {
        let mut m = std::collections::BTreeMap::new();
        m.insert("num_items".to_string(), sea_orm::Value::BigInt(Some(n)));
        m
    }

    fn user_row(email: &str, role: &str, password: &str) -> user::Model {
        let now = Utc::now();
        user::Model {
            id: Uuid::new_v4(),
            email: email.into(),
            name: "Ann".into(),
            password_hash: hash_password(password).unwrap(),
            role: role.into(),
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

    fn refresh_row(uid: Uuid) -> crate::auth::models::refresh_token::Model {
        let now = Utc::now();
        crate::auth::models::refresh_token::Model {
            id: Uuid::new_v4(),
            user_id: uid,
            session_id: Uuid::new_v4(),
            token_hash: "h".into(),
            ip_address: None,
            user_agent: None,
            expires_at: now,
            revoked_at: None,
            rotated_to: None,
            replay_detected_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn app(db: MockDatabase) -> Router {
        let conn = Arc::new(db.into_connection());
        let state = AuthState::new(
            conn,
            Signer::with_secret(b"signup-login-secret".to_vec()),
            Mailer::new(None),
        );
        Router::new()
            .route("/auth/signup", axum::routing::post(signup))
            .route("/auth/login", axum::routing::post(login))
            .with_state(state)
    }

    async fn post(app: Router, path: &str, json: serde_json::Value) -> Response {
        app.oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("content-type", "application/json")
                .body(Body::from(json.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
    }

    use axum::Router;

    #[tokio::test]
    async fn signup_creates_first_user_as_admin() {
        let empty: Vec<user::Model> = vec![];
        let created = user_row("new@b.com", "admin", "password123");
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([empty])
            .append_query_results([vec![count_row(0)]])
            .append_query_results([vec![created.clone()]])
            .append_query_results([vec![refresh_row(created.id)]])
            .append_query_results([vec![verification_token::Model {
                id: Uuid::new_v4(),
                user_id: created.id,
                kind: verification_token::KIND_EMAIL_VERIFY.into(),
                token_hash: "h".into(),
                expires_at: Utc::now(),
                consumed_at: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            }]])
            .into_connection();
        let conn = Arc::new(db);
        let state = AuthState::new(
            conn,
            Signer::with_secret(b"signup-login-secret".to_vec()),
            Mailer::new(None),
        );
        let router = Router::new()
            .route("/auth/signup", axum::routing::post(signup))
            .with_state(state);
        let resp = post(
            router,
            "/auth/signup",
            json!({"email":"new@b.com","name":"Ann","password":"password123"}),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn signup_conflicts_on_existing_email() {
        let existing = user_row("dup@b.com", "user", "password123");
        let db =
            MockDatabase::new(DatabaseBackend::Postgres).append_query_results([vec![existing]]);
        let resp = post(
            app(db),
            "/auth/signup",
            json!({"email":"dup@b.com","name":"Ann","password":"password123"}),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn signup_rejects_invalid_payload() {
        let db = MockDatabase::new(DatabaseBackend::Postgres);
        let resp = post(
            app(db),
            "/auth/signup",
            json!({"email":"bad","name":"","password":"short"}),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn login_succeeds_with_correct_password() {
        let u = user_row("a@b.com", "user", "password123");
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![refresh_row(u.id)]]);
        let resp = post(
            app(db),
            "/auth/login",
            json!({"email":"a@b.com","password":"password123"}),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn login_rejects_unknown_user() {
        let empty: Vec<user::Model> = vec![];
        let db = MockDatabase::new(DatabaseBackend::Postgres).append_query_results([empty]);
        let resp = post(
            app(db),
            "/auth/login",
            json!({"email":"ghost@b.com","password":"password123"}),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn login_wrong_password_registers_failure() {
        let u = user_row("a@b.com", "user", "password123");
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![u.clone()]]);
        let resp = post(
            app(db),
            "/auth/login",
            json!({"email":"a@b.com","password":"wrong-password"}),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn login_locked_account_429() {
        let mut u = user_row("a@b.com", "user", "password123");
        u.locked_until = Some(Utc::now() + Duration::minutes(10));
        let db = MockDatabase::new(DatabaseBackend::Postgres).append_query_results([vec![u]]);
        let resp = post(
            app(db),
            "/auth/login",
            json!({"email":"a@b.com","password":"password123"}),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn login_mfa_required_without_code() {
        let mut u = user_row("a@b.com", "user", "password123");
        u.mfa_enabled = true;
        u.mfa_secret_enc = Some(crate::auth::mfa::encode_secret("JBSWY3DPEHPK3PXP").unwrap());
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![u.clone()]]);
        let resp = post(
            app(db),
            "/auth/login",
            json!({"email":"a@b.com","password":"password123"}),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["mfa_required"], true);
    }

    #[tokio::test]
    async fn login_mfa_wrong_code_unauthorized() {
        let mut u = user_row("a@b.com", "user", "password123");
        u.mfa_enabled = true;
        u.mfa_secret_enc = Some(crate::auth::mfa::encode_secret("JBSWY3DPEHPK3PXP").unwrap());
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![u.clone()]]);
        let resp = post(
            app(db),
            "/auth/login",
            json!({"email":"a@b.com","password":"password123","mfa_code":"000000"}),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn too_many_helper_sets_429() {
        let resp = too_many("nope");
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn signup_exec_results_unused_ok() {
        let _ = MockExecResult {
            last_insert_id: 0,
            rows_affected: 1,
        };
    }
}
