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
}
