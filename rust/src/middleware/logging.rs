use std::time::Instant;

use axum::body::Body;
use axum::http::Request;
use axum::middleware::Next;
use axum::response::Response;

use crate::middleware::request_id::RequestId;

pub async fn log_request(req: Request<Body>, next: Next) -> Response {
    let start = Instant::now();
    let method = req.method().clone();
    let path = req.uri().path().to_owned();

    let response = next.run(req).await;
    let status = response.status().as_u16();
    let elapsed_ms = start.elapsed().as_millis() as u64;
    let request_id = RequestId::current().unwrap_or_default();

    tracing::info!(
        request_id = %request_id,
        method = %method,
        path = %path,
        status,
        duration_ms = elapsed_ms,
        "access"
    );

    response
}
