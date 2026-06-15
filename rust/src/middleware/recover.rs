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
