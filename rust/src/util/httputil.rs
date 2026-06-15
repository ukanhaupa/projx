use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;

pub fn json<T: Serialize>(status: StatusCode, body: T) -> impl IntoResponse {
    (status, Json(body))
}
