use std::env;

use axum::http::{header, HeaderName, HeaderValue, Method};
use tower_http::cors::{AllowOrigin, CorsLayer};

pub const ENV_ALLOW_ORIGINS: &str = "CORS_ALLOW_ORIGINS";

const DEFAULT_ORIGIN: &str = "http://localhost:5173";
const MAX_AGE_SECS: u64 = 600;

pub fn default_layer() -> CorsLayer {
    build_layer(env::var(ENV_ALLOW_ORIGINS).ok())
}

fn build_layer(origins_raw: Option<String>) -> CorsLayer {
    let origins = origins_raw
        .map(|raw| {
            raw.split(',')
                .map(|s| s.trim().to_owned())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec![DEFAULT_ORIGIN.to_owned()]);

    let wildcard = origins.iter().any(|o| o == "*");
    let allow_origin = if wildcard {
        AllowOrigin::any()
    } else {
        let parsed: Vec<HeaderValue> = origins
            .iter()
            .filter_map(|o| HeaderValue::from_str(o).ok())
            .collect();
        AllowOrigin::list(parsed)
    };

    CorsLayer::new()
        .allow_origin(allow_origin)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            HeaderName::from_static("x-request-id"),
        ])
        .allow_credentials(!wildcard)
        .max_age(std::time::Duration::from_secs(MAX_AGE_SECS))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    fn layer_for(origins: Option<&str>) -> CorsLayer {
        build_layer(origins.map(|s| s.to_owned()))
    }

    async fn preflight(layer: CorsLayer, origin: &str) -> axum::response::Response {
        let app = Router::new()
            .route("/x", get(|| async { "ok" }))
            .layer(layer);
        app.oneshot(
            Request::builder()
                .method(Method::OPTIONS)
                .uri("/x")
                .header("origin", origin)
                .header("access-control-request-method", "GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn default_origin_allows_localhost() {
        let resp = preflight(layer_for(None), DEFAULT_ORIGIN).await;
        assert_eq!(
            resp.headers().get("access-control-allow-origin").unwrap(),
            DEFAULT_ORIGIN
        );
        assert_eq!(
            resp.headers()
                .get("access-control-allow-credentials")
                .unwrap(),
            "true"
        );
    }

    #[tokio::test]
    async fn configured_origins_are_honoured() {
        let resp = preflight(
            layer_for(Some("https://a.test, https://b.test")),
            "https://b.test",
        )
        .await;
        assert_eq!(
            resp.headers().get("access-control-allow-origin").unwrap(),
            "https://b.test"
        );
    }

    #[tokio::test]
    async fn unlisted_origin_is_not_allowed() {
        let resp = preflight(layer_for(Some("https://a.test")), "https://evil.test").await;
        assert!(resp.headers().get("access-control-allow-origin").is_none());
    }

    #[tokio::test]
    async fn wildcard_allows_any_origin() {
        let resp = preflight(layer_for(Some("*")), "https://anything.test").await;
        assert_eq!(
            resp.headers().get("access-control-allow-origin").unwrap(),
            "*"
        );
    }

    #[tokio::test]
    async fn preflight_advertises_allowed_methods() {
        let resp = preflight(layer_for(None), DEFAULT_ORIGIN).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let methods = resp
            .headers()
            .get("access-control-allow-methods")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(methods.contains("PATCH"));
        assert!(methods.contains("DELETE"));
    }
}
