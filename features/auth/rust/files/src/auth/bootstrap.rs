use std::sync::Arc;

use axum::Router;
use sea_orm::DatabaseConnection;

use crate::auth::mailer::Mailer;
use crate::auth::router::{router, AuthState};
use crate::auth::service::Signer;
use crate::auth::verifier::Verifier;
use crate::serviceconfig::ServiceConfig;

pub fn mount(db: Arc<DatabaseConnection>) -> Router {
    let config = ServiceConfig::new(db.clone()).ok().map(Arc::new);
    let signer = Signer::new(config.clone());
    let mailer = Mailer::new(config);
    let state = AuthState::new(db.clone(), signer, mailer.clone());

    let verifier = match Verifier::from_env() {
        Ok(v) => Arc::new(v),
        Err(e) => {
            tracing::error!(error = %e, "auth: JWT verifier misconfigured; protected routes will reject every request until JWT_SECRET or JWT_JWKS_URL is set");
            Arc::new(deny_verifier())
        }
    };

    spawn_init(db, mailer);
    router(state, verifier)
}

fn deny_verifier() -> Verifier {
    let mut ephemeral = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut ephemeral);
    Verifier::new(crate::auth::verifier::VerifierConfig {
        provider: crate::auth::verifier::Provider::SharedSecret(ephemeral.to_vec()),
        algorithms: vec![jsonwebtoken::Algorithm::HS256],
        issuer: None,
        audience: None,
    })
    .expect("deny verifier construction is infallible with a non-empty secret")
}

fn spawn_init(db: Arc<DatabaseConnection>, mailer: Mailer) {
    tokio::spawn(async move {
        if let Err(e) = crate::auth::migrate::run(db.as_ref()).await {
            tracing::error!(error = %e, "auth: schema migration failed");
        }
        mailer.load().await;
        crate::auth::cron::spawn(db);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase};

    fn restore(key: &str, prev: Option<String>) {
        match prev {
            Some(v) => std::env::set_var(key, v),
            None => std::env::remove_var(key),
        }
    }

    #[tokio::test]
    async fn mount_builds_router_with_env_secret() {
        let _guard = crate::auth::service::ENV_LOCK.lock().unwrap();
        let prev = std::env::var("JWT_SECRET").ok();
        std::env::set_var("JWT_SECRET", "bootstrap-test-secret");
        std::env::set_var("AUTH_BACKGROUND_JOBS", "false");
        std::env::remove_var("CRED_ENCRYPTION_KEY");
        let db = Arc::new(MockDatabase::new(DatabaseBackend::Postgres).into_connection());
        let _ = mount(db);
        std::env::remove_var("AUTH_BACKGROUND_JOBS");
        restore("JWT_SECRET", prev);
    }

    #[tokio::test]
    async fn mount_falls_back_to_deny_verifier_when_misconfigured() {
        let _guard = crate::auth::service::ENV_LOCK.lock().unwrap();
        let prev_secret = std::env::var("JWT_SECRET").ok();
        let prev_jwks = std::env::var("JWT_JWKS_URL").ok();
        let prev_provider = std::env::var("JWT_PROVIDER").ok();
        std::env::remove_var("JWT_SECRET");
        std::env::remove_var("JWT_JWKS_URL");
        std::env::remove_var("JWT_PROVIDER");
        std::env::set_var("AUTH_BACKGROUND_JOBS", "false");
        let db = Arc::new(MockDatabase::new(DatabaseBackend::Postgres).into_connection());
        let _ = mount(db);
        std::env::remove_var("AUTH_BACKGROUND_JOBS");
        restore("JWT_SECRET", prev_secret);
        restore("JWT_JWKS_URL", prev_jwks);
        restore("JWT_PROVIDER", prev_provider);
    }

    #[tokio::test]
    async fn deny_verifier_rejects_foreign_tokens() {
        let v = deny_verifier();
        let token = jsonwebtoken::encode(
            &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256),
            &serde_json::json!({"sub": "u", "exp": 9_999_999_999u64}),
            &jsonwebtoken::EncodingKey::from_secret(b"some-other-secret"),
        )
        .unwrap();
        assert!(v.verify(&token).await.is_err());
    }
}
