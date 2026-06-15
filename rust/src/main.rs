use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use axum::middleware as axum_middleware;
use axum::Router;
use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use tokio::net::TcpListener;
use tokio::signal;
use tracing_subscriber::EnvFilter;

use projx::middleware::cors::default_layer as cors_layer;
use projx::middleware::logging::log_request;
use projx::middleware::recover::catch_panic;
use projx::middleware::request_id::RequestIdLayer;
use projx::{health, util};
// projx-anchor: imports

// projx-anchor: entity-imports

const DEFAULT_PORT: u16 = 8080;

#[tokio::main]
async fn main() -> Result<()> {
    load_dotenv()?;
    init_tracing();

    let db = open_db().await?;
    let db = Arc::new(db);

    // projx-anchor: entity-registrations

    let app = build_router(db.clone());

    let port: u16 = util::env::int("PORT", DEFAULT_PORT as u32) as u16;
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("bind {addr}"))?;
    tracing::info!(port, "server listening");

    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server crashed")?;

    Ok(())
}

fn build_router(db: Arc<DatabaseConnection>) -> Router {
    let stack = tower::ServiceBuilder::new()
        .layer(RequestIdLayer)
        .layer(axum_middleware::from_fn(log_request))
        .layer(cors_layer())
        .layer(axum_middleware::from_fn(catch_panic));

    Router::new()
        .merge(health::routes(db.clone()))
        // projx-anchor: plugins
        .layer(stack)
}

fn load_dotenv() -> Result<()> {
    if Path::new(".env").exists() {
        dotenvy::dotenv().context(".env present but failed to load")?;
    }
    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_env("LOG_LEVEL").unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .json()
        .with_current_span(false)
        .with_span_list(false)
        .init();
}

async fn open_db() -> Result<DatabaseConnection> {
    let url = util::env::required("DATABASE_URL")?;
    let mut opts = ConnectOptions::new(url);
    opts.max_connections(util::env::int("DB_POOL_MAX", 20))
        .min_connections(util::env::int("DB_POOL_IDLE", 5))
        .acquire_timeout(Duration::from_secs(
            util::env::int("DB_ACQUIRE_TIMEOUT_SEC", 10) as u64,
        ))
        .max_lifetime(Duration::from_secs(
            (util::env::int("DB_CONN_MAX_LIFETIME_MIN", 30) * 60) as u64,
        ))
        .sqlx_logging(false);
    Database::connect(opts).await.context("open postgres")
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c().await.expect("install ctrl-c handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => tracing::info!("received SIGINT, shutting down"),
        _ = terminate => tracing::info!("received SIGTERM, shutting down"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};
    use tower::ServiceExt;

    fn mock_db() -> Arc<DatabaseConnection> {
        Arc::new(
            MockDatabase::new(DatabaseBackend::Postgres)
                .append_exec_results([MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }])
                .into_connection(),
        )
    }

    #[tokio::test]
    async fn build_router_serves_health() {
        let app = build_router(mock_db());
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn build_router_propagates_request_id_header() {
        let app = build_router(mock_db());
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(resp.headers().get("x-request-id").is_some());
    }

    #[tokio::test]
    async fn build_router_unknown_route_404() {
        let app = build_router(mock_db());
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/no-such-path")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn load_dotenv_ok_when_absent() {
        assert!(load_dotenv().is_ok());
    }
}
