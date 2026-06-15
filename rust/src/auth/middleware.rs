use std::sync::Arc;

use axum::{
    async_trait,
    extract::{FromRequestParts, Request, State},
    http::{header, request::Parts},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::auth::verifier::{Claims, Verifier};
use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: String,
    pub email: String,
    pub role: String,
    pub permissions: Vec<String>,
    pub sid: String,
}

impl From<Claims> for AuthUser {
    fn from(c: Claims) -> Self {
        Self {
            id: c.sub,
            email: c.email,
            role: c.role,
            permissions: c.permissions,
            sid: c.sid,
        }
    }
}

#[tracing::instrument(skip(verifier, req, next))]
pub async fn authenticate(
    State(verifier): State<Arc<Verifier>>,
    mut req: Request,
    next: Next,
) -> Response {
    let header_val = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let token = extract_bearer(header_val);
    if token.is_empty() {
        return next.run(req).await;
    }
    match verifier.verify(token).await {
        Ok(claims) => {
            let user: AuthUser = claims.into();
            req.extensions_mut().insert(user);
            next.run(req).await
        }
        Err(e) => e.into_response(),
    }
}

pub fn extract_bearer(value: &str) -> &str {
    let mut parts = value.splitn(2, ' ');
    let scheme = parts.next().unwrap_or("");
    let rest = parts.next().unwrap_or("").trim();
    if scheme.eq_ignore_ascii_case("bearer") {
        rest
    } else {
        ""
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthUser>()
            .cloned()
            .ok_or_else(|| AppError::Unauthorized("authentication required".into()))
    }
}

pub struct RequireAuth(pub AuthUser);

#[async_trait]
impl<S> FromRequestParts<S> for RequireAuth
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        Ok(RequireAuth(user))
    }
}

pub struct RequireRole(pub AuthUser);

impl RequireRole {
    pub async fn enforce(parts: &mut Parts, roles: &[&str]) -> Result<AuthUser, AppError> {
        let user = parts
            .extensions
            .get::<AuthUser>()
            .cloned()
            .ok_or_else(|| AppError::Unauthorized("authentication required".into()))?;
        if roles.iter().any(|r| user.role == *r) {
            Ok(user)
        } else {
            Err(AppError::Forbidden("insufficient role".into()))
        }
    }
}

pub async fn require_auth_layer(req: Request, next: Next) -> Response {
    if req.extensions().get::<AuthUser>().is_some() {
        next.run(req).await
    } else {
        AppError::Unauthorized("authentication required".into()).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_bearer_happy() {
        assert_eq!(extract_bearer("Bearer abc"), "abc");
        assert_eq!(extract_bearer("bearer xyz"), "xyz");
    }

    #[test]
    fn extract_bearer_empty_on_missing_scheme() {
        assert_eq!(extract_bearer(""), "");
        assert_eq!(extract_bearer("Basic abc"), "");
    }

    #[test]
    fn extract_bearer_strips_whitespace() {
        assert_eq!(extract_bearer("Bearer    spaced  "), "spaced");
    }

    #[test]
    fn claims_into_auth_user() {
        let c = Claims {
            sub: "u".into(),
            email: "e".into(),
            role: "admin".into(),
            permissions: vec!["p".into()],
            sid: "s".into(),
            exp: None,
            nbf: None,
            iss: None,
            aud: serde_json::Value::Null,
        };
        let u: AuthUser = c.into();
        assert_eq!(u.id, "u");
        assert_eq!(u.email, "e");
        assert_eq!(u.role, "admin");
        assert_eq!(u.permissions, vec!["p"]);
        assert_eq!(u.sid, "s");
    }

    #[tokio::test]
    async fn require_role_enforce_passes_match() {
        let user = AuthUser {
            id: "1".into(),
            email: String::new(),
            role: "admin".into(),
            permissions: vec![],
            sid: String::new(),
        };
        let req = Request::builder().body(axum::body::Body::empty()).unwrap();
        let (mut parts, _) = req.into_parts();
        parts.extensions.insert(user);
        let result = RequireRole::enforce(&mut parts, &["admin"]).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn require_role_enforce_rejects_mismatch() {
        let user = AuthUser {
            id: "1".into(),
            email: String::new(),
            role: "user".into(),
            permissions: vec![],
            sid: String::new(),
        };
        let req = Request::builder().body(axum::body::Body::empty()).unwrap();
        let (mut parts, _) = req.into_parts();
        parts.extensions.insert(user);
        let err = RequireRole::enforce(&mut parts, &["admin"])
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Forbidden(_)));
    }

    #[tokio::test]
    async fn require_role_enforce_unauth_when_missing() {
        let req = Request::builder().body(axum::body::Body::empty()).unwrap();
        let (mut parts, _) = req.into_parts();
        let err = RequireRole::enforce(&mut parts, &["admin"])
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Unauthorized(_)));
    }

    #[tokio::test]
    async fn from_request_parts_missing_user_unauthorized() {
        let req = Request::builder().body(axum::body::Body::empty()).unwrap();
        let (mut parts, _) = req.into_parts();
        let err = AuthUser::from_request_parts(&mut parts, &())
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Unauthorized(_)));
    }

    #[tokio::test]
    async fn from_request_parts_present_user_ok() {
        let user = AuthUser {
            id: "u".into(),
            email: String::new(),
            role: String::new(),
            permissions: vec![],
            sid: String::new(),
        };
        let req = Request::builder().body(axum::body::Body::empty()).unwrap();
        let (mut parts, _) = req.into_parts();
        parts.extensions.insert(user);
        let got = AuthUser::from_request_parts(&mut parts, &()).await.unwrap();
        assert_eq!(got.id, "u");
        let wrapped = RequireAuth::from_request_parts(&mut parts, &())
            .await
            .unwrap();
        assert_eq!(wrapped.0.id, "u");
    }

    mod authenticate_flow {
        use super::super::*;
        use crate::auth::verifier::{Provider, Verifier, VerifierConfig};
        use axum::body::{to_bytes, Body};
        use axum::http::{Request, StatusCode};
        use axum::routing::get;
        use axum::{Extension, Router};
        use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
        use std::sync::Arc;
        use std::time::{SystemTime, UNIX_EPOCH};
        use tower::ServiceExt;

        #[tokio::test]
        async fn require_auth_layer_blocks_without_user() {
            let app = Router::new()
                .route("/guard", get(|| async { "ok" }))
                .layer(axum::middleware::from_fn(require_auth_layer));
            let resp = app
                .oneshot(
                    Request::builder()
                        .uri("/guard")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        }

        #[tokio::test]
        async fn require_auth_layer_allows_with_user() {
            async fn inject(mut req: Request<Body>, next: Next) -> axum::response::Response {
                req.extensions_mut().insert(AuthUser {
                    id: "u".into(),
                    email: String::new(),
                    role: String::new(),
                    permissions: vec![],
                    sid: String::new(),
                });
                next.run(req).await
            }
            let app = Router::new()
                .route("/guard", get(|| async { "ok" }))
                .layer(axum::middleware::from_fn(require_auth_layer))
                .layer(axum::middleware::from_fn(inject));
            let resp = app
                .oneshot(
                    Request::builder()
                        .uri("/guard")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::OK);
        }

        fn verifier(secret: &[u8]) -> Arc<Verifier> {
            Arc::new(
                Verifier::new(VerifierConfig {
                    provider: Provider::SharedSecret(secret.to_vec()),
                    algorithms: vec![Algorithm::HS256],
                    issuer: None,
                    audience: None,
                })
                .unwrap(),
            )
        }

        fn token(secret: &[u8], sub: &str) -> String {
            let exp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs()
                + 60;
            let claims = serde_json::json!({"sub": sub, "exp": exp, "role": "admin"});
            encode(
                &Header::new(Algorithm::HS256),
                &claims,
                &EncodingKey::from_secret(secret),
            )
            .unwrap()
        }

        async fn whoami(user: Option<Extension<AuthUser>>) -> String {
            match user {
                Some(Extension(u)) => u.id,
                None => "anon".into(),
            }
        }

        fn app(secret: &[u8]) -> Router {
            Router::new()
                .route("/me", get(whoami))
                .layer(axum::middleware::from_fn_with_state(
                    verifier(secret),
                    authenticate,
                ))
        }

        #[tokio::test]
        async fn valid_token_injects_user() {
            let app = app(b"sek");
            let resp = app
                .oneshot(
                    Request::builder()
                        .uri("/me")
                        .header(
                            "authorization",
                            format!("Bearer {}", token(b"sek", "user-9")),
                        )
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::OK);
            let body = to_bytes(resp.into_body(), 1024).await.unwrap();
            assert_eq!(&body[..], b"user-9");
        }

        #[tokio::test]
        async fn no_token_passes_through_anonymous() {
            let app = app(b"sek");
            let resp = app
                .oneshot(Request::builder().uri("/me").body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::OK);
            let body = to_bytes(resp.into_body(), 1024).await.unwrap();
            assert_eq!(&body[..], b"anon");
        }

        #[tokio::test]
        async fn invalid_token_rejected_401() {
            let app = app(b"sek");
            let resp = app
                .oneshot(
                    Request::builder()
                        .uri("/me")
                        .header("authorization", format!("Bearer {}", token(b"wrong", "x")))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        }
    }
}
