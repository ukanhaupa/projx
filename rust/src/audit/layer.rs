use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;

use crate::audit::actor;
use crate::auth::middleware::AuthUser;

pub async fn capture_actor(req: Request, next: Next) -> Response {
    let who = req.extensions().get::<AuthUser>().map(|u| {
        if u.email.is_empty() {
            u.id.clone()
        } else {
            u.email.clone()
        }
    });
    actor::scope(who, next.run(req)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audit::actor;
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    async fn echo_actor() -> String {
        actor::current()
    }

    fn app() -> Router {
        Router::new()
            .route("/who", get(echo_actor))
            .layer(axum::middleware::from_fn(capture_actor))
    }

    async fn body_str(resp: Response) -> String {
        let bytes = to_bytes(resp.into_body(), 1024).await.unwrap();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    #[tokio::test]
    async fn defaults_to_system_without_auth_user() {
        let resp = app()
            .oneshot(Request::builder().uri("/who").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(body_str(resp).await, actor::SYSTEM_ACTOR);
    }

    #[tokio::test]
    async fn uses_email_from_auth_user() {
        async fn inject(mut req: Request<Body>, next: Next) -> Response {
            req.extensions_mut().insert(AuthUser {
                id: "u-1".into(),
                email: "bob@example.com".into(),
                role: String::new(),
                permissions: vec![],
                sid: String::new(),
            });
            next.run(req).await
        }
        let app = Router::new()
            .route("/who", get(echo_actor))
            .layer(axum::middleware::from_fn(capture_actor))
            .layer(axum::middleware::from_fn(inject));
        let resp = app
            .oneshot(Request::builder().uri("/who").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(body_str(resp).await, "bob@example.com");
    }

    #[tokio::test]
    async fn falls_back_to_id_when_email_empty() {
        async fn inject(mut req: Request<Body>, next: Next) -> Response {
            req.extensions_mut().insert(AuthUser {
                id: "u-2".into(),
                email: String::new(),
                role: String::new(),
                permissions: vec![],
                sid: String::new(),
            });
            next.run(req).await
        }
        let app = Router::new()
            .route("/who", get(echo_actor))
            .layer(axum::middleware::from_fn(capture_actor))
            .layer(axum::middleware::from_fn(inject));
        let resp = app
            .oneshot(Request::builder().uri("/who").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(body_str(resp).await, "u-2");
    }
}
