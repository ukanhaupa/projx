use std::sync::Arc;

use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::apperr::from_db;
use crate::auth::models::{refresh_token, user};
use crate::auth::password::hash_token;
use crate::error::AppError;
use crate::serviceconfig::ServiceConfig;

pub const ACCESS_TTL_MINUTES: i64 = 15;
pub const REFRESH_TTL_DAYS: i64 = 7;
pub const MFA_CHALLENGE_TTL_MINUTES: i64 = 5;

pub const LOGIN_MAX_ATTEMPTS: i32 = 5;
pub const LOGIN_LOCKOUT_MINUTES: i64 = 15;

const JWT_SECRET_CONFIG_KEY: &str = "jwt_secret";

#[cfg(test)]
pub static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn permissions_for_role(role: &str) -> Vec<String> {
    match role {
        "admin" => vec!["*:*.*".to_string()],
        "user" => vec!["*:read.*".to_string()],
        _ => Vec::new(),
    }
}

#[derive(Clone)]
pub struct Signer {
    config: Option<Arc<ServiceConfig>>,
    explicit_secret: Option<Arc<Vec<u8>>>,
}

#[derive(Serialize, Deserialize)]
struct AccessClaims {
    sub: String,
    sid: String,
    email: String,
    name: String,
    role: String,
    permissions: Vec<String>,
    token_type: String,
    jti: String,
    iat: i64,
    exp: i64,
}

#[derive(Serialize, Deserialize)]
struct ChallengeClaims {
    sub: String,
    stage: String,
    iat: i64,
    exp: i64,
}

#[derive(Deserialize)]
struct RefreshClaims {
    sub: String,
    sid: String,
    token_type: String,
}

pub struct TokenPayload {
    pub sub: Uuid,
    pub sid: Uuid,
    pub email: String,
    pub name: String,
    pub role: String,
}

#[derive(Debug)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
}

impl Signer {
    pub fn new(config: Option<Arc<ServiceConfig>>) -> Self {
        Self {
            config,
            explicit_secret: None,
        }
    }

    pub fn with_secret(secret: impl Into<Vec<u8>>) -> Self {
        Self {
            config: None,
            explicit_secret: Some(Arc::new(secret.into())),
        }
    }

    async fn secret(&self) -> Result<Vec<u8>, AppError> {
        if let Some(s) = &self.explicit_secret {
            return Ok(s.as_ref().clone());
        }
        if let Some(cfg) = &self.config {
            if let Ok(v) = cfg.get(JWT_SECRET_CONFIG_KEY).await {
                if !v.is_empty() {
                    return Ok(v.into_bytes());
                }
            }
        }
        match std::env::var("JWT_SECRET") {
            Ok(v) if !v.trim().is_empty() => Ok(v.into_bytes()),
            _ => Err(AppError::Internal(anyhow::anyhow!(
                "auth: JWT secret not configured (service_configs:jwt_secret or env JWT_SECRET)"
            ))),
        }
    }

    pub async fn issue_tokens(&self, p: &TokenPayload) -> Result<TokenPair, AppError> {
        let secret = self.secret().await?;
        let key = EncodingKey::from_secret(&secret);
        let now = Utc::now();
        let perms = permissions_for_role(&p.role);

        let access = AccessClaims {
            sub: p.sub.to_string(),
            sid: p.sid.to_string(),
            email: p.email.clone(),
            name: p.name.clone(),
            role: p.role.clone(),
            permissions: perms.clone(),
            token_type: "access".into(),
            jti: Uuid::new_v4().to_string(),
            iat: now.timestamp(),
            exp: (now + Duration::minutes(ACCESS_TTL_MINUTES)).timestamp(),
        };
        let refresh = AccessClaims {
            sub: p.sub.to_string(),
            sid: p.sid.to_string(),
            email: p.email.clone(),
            name: p.name.clone(),
            role: p.role.clone(),
            permissions: perms,
            token_type: "refresh".into(),
            jti: Uuid::new_v4().to_string(),
            iat: now.timestamp(),
            exp: (now + Duration::days(REFRESH_TTL_DAYS)).timestamp(),
        };

        let header = Header::new(Algorithm::HS256);
        let access_token = encode(&header, &access, &key)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("sign access: {e}")))?;
        let refresh_token = encode(&header, &refresh, &key)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("sign refresh: {e}")))?;
        Ok(TokenPair {
            access_token,
            refresh_token,
        })
    }

    pub async fn sign_mfa_challenge(&self, user_id: Uuid) -> Result<String, AppError> {
        let secret = self.secret().await?;
        let now = Utc::now();
        let claims = ChallengeClaims {
            sub: user_id.to_string(),
            stage: "mfa_pending".into(),
            iat: now.timestamp(),
            exp: (now + Duration::minutes(MFA_CHALLENGE_TTL_MINUTES)).timestamp(),
        };
        encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(&secret),
        )
        .map_err(|e| AppError::Internal(anyhow::anyhow!("sign challenge: {e}")))
    }

    async fn verify_refresh(&self, token: &str) -> Result<RefreshClaims, AppError> {
        let secret = self.secret().await?;
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_required_spec_claims(&["exp"]);
        validation.validate_exp = true;
        let data = decode::<RefreshClaims>(token, &DecodingKey::from_secret(&secret), &validation)
            .map_err(|_| AppError::Unauthorized("invalid refresh token".into()))?;
        Ok(data.claims)
    }
}

#[derive(Clone)]
pub struct Sessions {
    db: Arc<DatabaseConnection>,
    signer: Signer,
}

pub struct IssueArgs {
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
}

impl Sessions {
    pub fn new(db: Arc<DatabaseConnection>, signer: Signer) -> Self {
        Self { db, signer }
    }

    pub fn signer(&self) -> &Signer {
        &self.signer
    }

    pub async fn issue(&self, u: &user::Model, args: &IssueArgs) -> Result<TokenPair, AppError> {
        let session_id = Uuid::new_v4();
        let pair = self
            .signer
            .issue_tokens(&TokenPayload {
                sub: u.id,
                sid: session_id,
                email: u.email.clone(),
                name: u.name.clone(),
                role: u.role.clone(),
            })
            .await?;
        let row = refresh_token::Model::active(
            u.id,
            session_id,
            hash_token(&pair.refresh_token),
            args.ip_address.clone(),
            args.user_agent.clone(),
            Utc::now() + Duration::days(REFRESH_TTL_DAYS),
        );
        row.insert(self.db.as_ref())
            .await
            .map_err(|e| from_db(e, "refresh_token"))?;
        Ok(pair)
    }

    pub async fn rotate(
        &self,
        refresh_token_raw: &str,
        args: &IssueArgs,
    ) -> Result<TokenPair, AppError> {
        let claims = self.signer.verify_refresh(refresh_token_raw).await?;
        if claims.token_type != "refresh" {
            return Err(AppError::Unauthorized("invalid refresh token".into()));
        }
        let sid = Uuid::parse_str(&claims.sid)
            .map_err(|_| AppError::Unauthorized("invalid refresh token".into()))?;
        let sub = Uuid::parse_str(&claims.sub)
            .map_err(|_| AppError::Unauthorized("invalid refresh token".into()))?;

        let hash = hash_token(refresh_token_raw);
        let row = refresh_token::Entity::find()
            .filter(refresh_token::Column::TokenHash.eq(hash))
            .one(self.db.as_ref())
            .await
            .map_err(|e| from_db(e, "refresh_token"))?
            .ok_or_else(|| AppError::Unauthorized("invalid refresh token".into()))?;

        if row.session_id != sid || row.user_id != sub {
            return Err(AppError::Unauthorized("invalid refresh token".into()));
        }

        if row.rotated_to.is_some() || row.revoked_at.is_some() {
            self.handle_replay(&row).await?;
            return Err(AppError::Unauthorized("token_replay_detected".into()));
        }

        if row.expires_at < Utc::now() {
            return Err(AppError::Unauthorized("invalid refresh token".into()));
        }

        let u = user::Entity::find_by_id(row.user_id)
            .one(self.db.as_ref())
            .await
            .map_err(|e| from_db(e, "user"))?
            .ok_or_else(|| AppError::Unauthorized("invalid refresh token".into()))?;

        let pair = self
            .signer
            .issue_tokens(&TokenPayload {
                sub: u.id,
                sid: row.session_id,
                email: u.email.clone(),
                name: u.name.clone(),
                role: u.role.clone(),
            })
            .await?;

        let new_row = refresh_token::Model::active(
            u.id,
            row.session_id,
            hash_token(&pair.refresh_token),
            args.ip_address.clone(),
            args.user_agent.clone(),
            Utc::now() + Duration::days(REFRESH_TTL_DAYS),
        );

        let txn = self
            .db
            .begin()
            .await
            .map_err(|e| from_db(e, "refresh_token"))?;
        let inserted = new_row
            .insert(&txn)
            .await
            .map_err(|e| from_db(e, "refresh_token"))?;
        let now = Utc::now();
        refresh_token::Entity::update_many()
            .col_expr(
                refresh_token::Column::RotatedTo,
                sea_orm::sea_query::Expr::value(Some(inserted.id)),
            )
            .col_expr(
                refresh_token::Column::RevokedAt,
                sea_orm::sea_query::Expr::value(Some(now)),
            )
            .col_expr(
                refresh_token::Column::UpdatedAt,
                sea_orm::sea_query::Expr::value(now),
            )
            .filter(refresh_token::Column::Id.eq(row.id))
            .exec(&txn)
            .await
            .map_err(|e| from_db(e, "refresh_token"))?;
        txn.commit()
            .await
            .map_err(|e| from_db(e, "refresh_token"))?;

        Ok(pair)
    }

    async fn handle_replay(&self, row: &refresh_token::Model) -> Result<(), AppError> {
        let now = Utc::now();
        refresh_token::Entity::update_many()
            .col_expr(
                refresh_token::Column::RevokedAt,
                sea_orm::sea_query::Expr::value(Some(now)),
            )
            .filter(refresh_token::Column::SessionId.eq(row.session_id))
            .filter(refresh_token::Column::RevokedAt.is_null())
            .exec(self.db.as_ref())
            .await
            .map_err(|e| from_db(e, "refresh_token"))?;
        refresh_token::Entity::update_many()
            .col_expr(
                refresh_token::Column::ReplayDetectedAt,
                sea_orm::sea_query::Expr::value(Some(now)),
            )
            .col_expr(
                refresh_token::Column::UpdatedAt,
                sea_orm::sea_query::Expr::value(now),
            )
            .filter(refresh_token::Column::Id.eq(row.id))
            .exec(self.db.as_ref())
            .await
            .map_err(|e| from_db(e, "refresh_token"))?;
        Ok(())
    }

    pub async fn revoke_session(&self, user_id: Uuid, session_id: Uuid) -> Result<(), AppError> {
        refresh_token::Entity::update_many()
            .col_expr(
                refresh_token::Column::RevokedAt,
                sea_orm::sea_query::Expr::value(Some(Utc::now())),
            )
            .filter(refresh_token::Column::SessionId.eq(session_id))
            .filter(refresh_token::Column::UserId.eq(user_id))
            .filter(refresh_token::Column::RevokedAt.is_null())
            .exec(self.db.as_ref())
            .await
            .map_err(|e| from_db(e, "refresh_token"))?;
        Ok(())
    }

    pub async fn revoke_all_for_user(&self, user_id: Uuid) -> Result<(), AppError> {
        refresh_token::Entity::update_many()
            .col_expr(
                refresh_token::Column::RevokedAt,
                sea_orm::sea_query::Expr::value(Some(Utc::now())),
            )
            .filter(refresh_token::Column::UserId.eq(user_id))
            .filter(refresh_token::Column::RevokedAt.is_null())
            .exec(self.db.as_ref())
            .await
            .map_err(|e| from_db(e, "refresh_token"))?;
        Ok(())
    }
}

pub fn is_account_locked(u: &user::Model) -> bool {
    match u.locked_until {
        Some(t) => t > Utc::now(),
        None => false,
    }
}

pub async fn register_failed_login(
    db: &DatabaseConnection,
    u: &user::Model,
) -> Result<(), AppError> {
    let next = u.failed_login_count + 1;
    let mut am: user::ActiveModel = u.clone().into();
    am.failed_login_count = Set(next);
    if next >= LOGIN_MAX_ATTEMPTS {
        am.locked_until = Set(Some(Utc::now() + Duration::minutes(LOGIN_LOCKOUT_MINUTES)));
    }
    am.updated_at = Set(Utc::now());
    am.update(db).await.map_err(|e| from_db(e, "user"))?;
    Ok(())
}

pub async fn reset_login_counters(
    db: &DatabaseConnection,
    u: &user::Model,
) -> Result<(), AppError> {
    let mut am: user::ActiveModel = u.clone().into();
    am.failed_login_count = Set(0);
    am.locked_until = Set(None);
    am.last_login = Set(Some(Utc::now()));
    am.updated_at = Set(Utc::now());
    am.update(db).await.map_err(|e| from_db(e, "user"))?;
    Ok(())
}

pub async fn register_mfa_failure(
    db: &DatabaseConnection,
    u: &user::Model,
) -> Result<(), AppError> {
    let next = u.mfa_failed_count + 1;
    let mut am: user::ActiveModel = u.clone().into();
    am.mfa_failed_count = Set(next);
    if next >= crate::auth::mfa::MFA_MAX_ATTEMPTS {
        am.mfa_locked_until = Set(Some(
            Utc::now() + Duration::minutes(crate::auth::mfa::MFA_LOCKOUT_MINUTES),
        ));
    }
    am.updated_at = Set(Utc::now());
    am.update(db).await.map_err(|e| from_db(e, "user"))?;
    Ok(())
}

pub async fn reset_mfa_counters(db: &DatabaseConnection, u: &user::Model) -> Result<(), AppError> {
    let mut am: user::ActiveModel = u.clone().into();
    am.mfa_failed_count = Set(0);
    am.mfa_locked_until = Set(None);
    am.updated_at = Set(Utc::now());
    am.update(db).await.map_err(|e| from_db(e, "user"))?;
    Ok(())
}

pub fn user_public(u: &user::Model) -> Value {
    json!({
        "id": u.id.to_string(),
        "email": u.email,
        "name": u.name,
        "role": u.role,
        "email_verified": u.email_verified,
        "mfa_enabled": u.mfa_enabled,
        "last_login": u.last_login,
        "created_at": u.created_at,
        "updated_at": u.updated_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

    fn sample_user() -> user::Model {
        let now = Utc::now();
        user::Model {
            id: Uuid::new_v4(),
            email: "a@b.com".into(),
            name: "Ann".into(),
            password_hash: "hash".into(),
            role: "admin".into(),
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

    fn signer_env() -> Signer {
        Signer::with_secret(b"test-secret-value-123".to_vec())
    }

    #[test]
    fn permissions_for_role_known_and_unknown() {
        assert_eq!(permissions_for_role("admin"), vec!["*:*.*"]);
        assert_eq!(permissions_for_role("user"), vec!["*:read.*"]);
        assert!(permissions_for_role("ghost").is_empty());
    }

    #[tokio::test]
    async fn issue_tokens_produces_verifiable_pair() {
        let signer = signer_env();
        let pair = signer
            .issue_tokens(&TokenPayload {
                sub: Uuid::new_v4(),
                sid: Uuid::new_v4(),
                email: "a@b.com".into(),
                name: "Ann".into(),
                role: "admin".into(),
            })
            .await
            .unwrap();
        assert!(!pair.access_token.is_empty());
        let claims = signer.verify_refresh(&pair.refresh_token).await.unwrap();
        assert_eq!(claims.token_type, "refresh");
    }

    #[tokio::test]
    async fn verify_refresh_rejects_garbage() {
        let signer = signer_env();
        assert!(signer.verify_refresh("not.a.token").await.is_err());
    }

    #[tokio::test]
    async fn sign_mfa_challenge_round_trips_through_verify() {
        let signer = signer_env();
        let uid = Uuid::new_v4();
        let token = signer.sign_mfa_challenge(uid).await.unwrap();
        assert!(!token.is_empty());
    }

    #[tokio::test]
    async fn secret_errors_without_config_or_env() {
        let _guard = crate::auth::service::ENV_LOCK.lock().unwrap();
        let prev = std::env::var("JWT_SECRET").ok();
        std::env::remove_var("JWT_SECRET");
        let signer = Signer::new(None);
        let result = signer.secret().await;
        if let Some(v) = prev {
            std::env::set_var("JWT_SECRET", v);
        }
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn issue_inserts_refresh_row() {
        let signer = signer_env();
        let u = sample_user();
        let inserted = refresh_token::Model {
            id: Uuid::new_v4(),
            user_id: u.id,
            session_id: Uuid::new_v4(),
            token_hash: "h".into(),
            ip_address: None,
            user_agent: None,
            expires_at: Utc::now(),
            revoked_at: None,
            rotated_to: None,
            replay_detected_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let db = Arc::new(
            MockDatabase::new(DatabaseBackend::Postgres)
                .append_query_results([vec![inserted]])
                .into_connection(),
        );
        let sessions = Sessions::new(db, signer);
        let pair = sessions
            .issue(
                &u,
                &IssueArgs {
                    ip_address: None,
                    user_agent: None,
                },
            )
            .await
            .unwrap();
        assert!(!pair.access_token.is_empty());
    }

    #[tokio::test]
    async fn rotate_rejects_invalid_token() {
        let signer = signer_env();
        let db = Arc::new(MockDatabase::new(DatabaseBackend::Postgres).into_connection());
        let sessions = Sessions::new(db, signer);
        let err = sessions
            .rotate(
                "bad",
                &IssueArgs {
                    ip_address: None,
                    user_agent: None,
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Unauthorized(_)));
    }

    #[tokio::test]
    async fn rotate_detects_replay_on_already_rotated_row() {
        let signer = signer_env();
        let uid = Uuid::new_v4();
        let sid = Uuid::new_v4();
        let pair = signer
            .issue_tokens(&TokenPayload {
                sub: uid,
                sid,
                email: "a@b.com".into(),
                name: "Ann".into(),
                role: "admin".into(),
            })
            .await
            .unwrap();
        let row = refresh_token::Model {
            id: Uuid::new_v4(),
            user_id: uid,
            session_id: sid,
            token_hash: hash_token(&pair.refresh_token),
            ip_address: None,
            user_agent: None,
            expires_at: Utc::now() + Duration::days(1),
            revoked_at: Some(Utc::now()),
            rotated_to: Some(Uuid::new_v4()),
            replay_detected_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let db = Arc::new(
            MockDatabase::new(DatabaseBackend::Postgres)
                .append_query_results([vec![row]])
                .append_exec_results([MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }])
                .append_exec_results([MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }])
                .into_connection(),
        );
        let sessions = Sessions::new(db, signer);
        let err = sessions
            .rotate(
                &pair.refresh_token,
                &IssueArgs {
                    ip_address: None,
                    user_agent: None,
                },
            )
            .await
            .unwrap_err();
        assert_eq!(err.detail(), "token_replay_detected");
    }

    #[tokio::test]
    async fn rotate_happy_path_issues_new_pair() {
        let signer = signer_env();
        let u = sample_user();
        let sid = Uuid::new_v4();
        let pair = signer
            .issue_tokens(&TokenPayload {
                sub: u.id,
                sid,
                email: u.email.clone(),
                name: u.name.clone(),
                role: u.role.clone(),
            })
            .await
            .unwrap();
        let row = refresh_token::Model {
            id: Uuid::new_v4(),
            user_id: u.id,
            session_id: sid,
            token_hash: hash_token(&pair.refresh_token),
            ip_address: None,
            user_agent: None,
            expires_at: Utc::now() + Duration::days(1),
            revoked_at: None,
            rotated_to: None,
            replay_detected_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let new_inserted = refresh_token::Model {
            id: Uuid::new_v4(),
            ..row.clone()
        };
        let db = Arc::new(
            MockDatabase::new(DatabaseBackend::Postgres)
                .append_query_results([vec![row]])
                .append_query_results([vec![u.clone()]])
                .append_query_results([vec![new_inserted]])
                .append_exec_results([MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }])
                .into_connection(),
        );
        let sessions = Sessions::new(db, signer);
        let out = sessions
            .rotate(
                &pair.refresh_token,
                &IssueArgs {
                    ip_address: Some("1.2.3.4".into()),
                    user_agent: Some("test".into()),
                },
            )
            .await
            .unwrap();
        assert!(!out.access_token.is_empty());
    }

    #[tokio::test]
    async fn revoke_session_and_all_execute_updates() {
        let db = Arc::new(
            MockDatabase::new(DatabaseBackend::Postgres)
                .append_exec_results([MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }])
                .append_exec_results([MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 2,
                }])
                .into_connection(),
        );
        let sessions = Sessions::new(db, signer_env());
        assert!(sessions
            .revoke_session(Uuid::new_v4(), Uuid::new_v4())
            .await
            .is_ok());
        assert!(sessions.revoke_all_for_user(Uuid::new_v4()).await.is_ok());
    }

    #[test]
    fn is_account_locked_logic() {
        let mut u = sample_user();
        assert!(!is_account_locked(&u));
        u.locked_until = Some(Utc::now() + Duration::minutes(5));
        assert!(is_account_locked(&u));
        u.locked_until = Some(Utc::now() - Duration::minutes(5));
        assert!(!is_account_locked(&u));
    }

    #[tokio::test]
    async fn register_failed_login_locks_after_threshold() {
        let mut u = sample_user();
        u.failed_login_count = LOGIN_MAX_ATTEMPTS - 1;
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![u.clone()]])
            .into_connection();
        assert!(register_failed_login(&db, &u).await.is_ok());
    }

    #[tokio::test]
    async fn reset_counters_execute() {
        let u = sample_user();
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![u.clone()]])
            .append_query_results([vec![u.clone()]])
            .into_connection();
        assert!(reset_login_counters(&db, &u).await.is_ok());
        assert!(register_mfa_failure(&db, &u).await.is_ok());
        assert!(reset_mfa_counters(&db, &u).await.is_ok());
    }

    #[test]
    fn user_public_hides_sensitive() {
        let u = sample_user();
        let v = user_public(&u);
        assert_eq!(v["email"], "a@b.com");
        assert!(v.get("password_hash").is_none());
        assert!(v.get("mfa_secret_enc").is_none());
    }
}
