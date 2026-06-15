use std::panic::AssertUnwindSafe;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::FutureExt;

use crate::error::ErrorEnvelope;
use crate::middleware::request_id::RequestId;

pub async fn catch_panic(req: Request<Body>, next: Next) -> Response {
    match AssertUnwindSafe(next.run(req)).catch_unwind().await {
        Ok(response) => response,
        Err(panic) => {
            let request_id = RequestId::current().unwrap_or_default();
            let message = panic_message(&*panic);
            tracing::error!(
                request_id = %request_id,
                panic = %message,
                "panic recovered"
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorEnvelope {
                    detail: "internal server error".into(),
                    request_id,
                }),
            )
                .into_response()
        }
    }
}

fn panic_message(panic: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = panic.downcast_ref::<&'static str>() {
        return (*s).to_owned();
    }
    if let Some(s) = panic.downcast_ref::<String>() {
        return s.clone();
    }
    "<non-string panic payload>".to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    #[tokio::test]
    async fn catches_panic_and_returns_500_envelope() {
        async fn boom() -> &'static str {
            panic!("kaboom")
        }
        let app = Router::new()
            .route("/boom", get(boom))
            .layer(axum::middleware::from_fn(catch_panic));
        let resp = app
            .oneshot(Request::builder().uri("/boom").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let bytes = to_bytes(resp.into_body(), 1024).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["detail"], "internal server error");
        assert!(v.get("request_id").is_some());
    }

    #[tokio::test]
    async fn passes_through_when_no_panic() {
        let app = Router::new()
            .route("/ok", get(|| async { "fine" }))
            .layer(axum::middleware::from_fn(catch_panic));
        let resp = app
            .oneshot(Request::builder().uri("/ok").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[test]
    fn panic_message_handles_str_string_and_other() {
        assert_eq!(panic_message(&"literal"), "literal");
        assert_eq!(panic_message(&String::from("owned")), "owned");
        assert_eq!(panic_message(&42i32), "<non-string panic payload>");
    }
}
