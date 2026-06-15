use std::sync::Arc;

use axum::http::HeaderMap;
use axum::middleware::from_fn_with_state;
use axum::routing::post;
use axum::Router;
use sea_orm::DatabaseConnection;

use crate::auth::mailer::Mailer;
use crate::auth::middleware::{authenticate, require_auth_layer};
use crate::auth::service::{Sessions, Signer};
use crate::auth::verifier::Verifier;

#[derive(Clone)]
pub struct AuthState {
    pub db: Arc<DatabaseConnection>,
    pub sessions: Sessions,
    pub mailer: Mailer,
}

impl AuthState {
    pub fn new(db: Arc<DatabaseConnection>, signer: Signer, mailer: Mailer) -> Self {
        Self {
            sessions: Sessions::new(db.clone(), signer),
            db,
            mailer,
        }
    }

    pub fn signer(&self) -> &Signer {
        self.sessions.signer()
    }
}

pub fn router(state: AuthState, verifier: Arc<Verifier>) -> Router {
    let public = Router::new()
        .route("/auth/signup", post(super::signup_login::signup))
        .route("/auth/login", post(super::signup_login::login))
        .route("/auth/refresh", post(super::refresh::refresh))
        .route(
            "/auth/password-reset/request",
            post(super::password_reset::request_reset),
        )
        .route(
            "/auth/password-reset/confirm",
            post(super::password_reset::confirm_reset),
        )
        .route(
            "/auth/email-verify/confirm",
            post(super::email_verify::confirm),
        )
        .with_state(state.clone());

    let protected = Router::new()
        .route("/auth/logout", post(super::logout::logout))
        .route(
            "/auth/email-verify/request",
            post(super::email_verify::request),
        )
        .route("/auth/mfa/enroll", post(super::mfa_handler::enroll))
        .route("/auth/mfa/verify", post(super::mfa_handler::verify))
        .route("/auth/mfa/disable", post(super::mfa_handler::disable))
        .route_layer(axum::middleware::from_fn(require_auth_layer))
        .route_layer(from_fn_with_state(verifier, authenticate))
        .with_state(state);

    public.merge(protected)
}

pub fn client_ip(headers: &HeaderMap) -> Option<String> {
    let fwd = headers.get("x-forwarded-for")?.to_str().ok()?;
    let first = fwd.split(',').next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(first.to_string())
    }
}

pub fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::verifier::{Provider, Verifier, VerifierConfig};
    use jsonwebtoken::Algorithm;
    use sea_orm::{DatabaseBackend, MockDatabase};

    fn state() -> AuthState {
        let db = Arc::new(MockDatabase::new(DatabaseBackend::Postgres).into_connection());
        AuthState::new(
            db,
            Signer::with_secret(b"router-test-secret".to_vec()),
            Mailer::new(None),
        )
    }

    fn verifier() -> Arc<Verifier> {
        Arc::new(
            Verifier::new(VerifierConfig {
                provider: Provider::SharedSecret(b"router-test-secret".to_vec()),
                algorithms: vec![Algorithm::HS256],
                issuer: None,
                audience: None,
            })
            .unwrap(),
        )
    }

    #[test]
    fn router_builds() {
        let _ = router(state(), verifier());
    }

    #[test]
    fn state_exposes_signer() {
        let s = state();
        let _ = s.signer();
    }

    #[test]
    fn client_ip_parses_forwarded_header() {
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", "1.2.3.4, 5.6.7.8".parse().unwrap());
        assert_eq!(client_ip(&h), Some("1.2.3.4".to_string()));
        assert_eq!(client_ip(&HeaderMap::new()), None);
    }

    #[test]
    fn client_ip_none_on_empty() {
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", "   ".parse().unwrap());
        assert_eq!(client_ip(&h), None);
    }

    #[test]
    fn user_agent_extracted() {
        let mut h = HeaderMap::new();
        h.insert("user-agent", "curl/8".parse().unwrap());
        assert_eq!(user_agent(&h), Some("curl/8".to_string()));
        assert_eq!(user_agent(&HeaderMap::new()), None);
    }
}
