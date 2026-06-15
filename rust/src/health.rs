use std::sync::Arc;

use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Serialize)]
struct StatusBody {
    status: &'static str,
}

pub fn routes(db: Arc<DatabaseConnection>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .with_state(db)
}

#[tracing::instrument]
pub async fn health() -> impl IntoResponse {
    (StatusCode::OK, Json(StatusBody { status: "ok" }))
}

#[tracing::instrument(skip(db))]
pub async fn ready(State(db): State<Arc<DatabaseConnection>>) -> AppResult<impl IntoResponse> {
    db.execute(Statement::from_string(
        DatabaseBackend::Postgres,
        "SELECT 1".to_owned(),
    ))
    .await
    .map_err(|e| AppError::Internal(anyhow::Error::from(e)))?;
    Ok((StatusCode::OK, Json(StatusBody { status: "ready" })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    #[tokio::test]
    async fn health_returns_ok() {
        let resp = health().await.into_response();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = to_bytes(resp.into_body(), 1024).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["status"], "ok");
    }
}
