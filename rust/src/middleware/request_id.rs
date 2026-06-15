use std::task::{Context, Poll};

use axum::body::Body;
use axum::http::{HeaderName, HeaderValue, Request, Response};
use tokio::task_local;
use tower::{Layer, Service};
use uuid::Uuid;

pub const HEADER_NAME: &str = "x-request-id";
pub static HEADER: HeaderName = HeaderName::from_static(HEADER_NAME);

task_local! {
    static REQUEST_ID: String;
}

pub struct RequestId;

impl RequestId {
    pub fn current() -> Option<String> {
        REQUEST_ID.try_with(|v| v.clone()).ok()
    }
}

#[derive(Clone, Default)]
pub struct RequestIdLayer;

impl<S> Layer<S> for RequestIdLayer {
    type Service = RequestIdService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        RequestIdService { inner }
    }
}

#[derive(Clone)]
pub struct RequestIdService<S> {
    inner: S,
}

impl<S> Service<Request<Body>> for RequestIdService<S>
where
    S: Service<Request<Body>, Response = Response<Body>> + Clone + Send + 'static,
    S::Future: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = futures_compat::BoxFuture<Result<S::Response, S::Error>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, mut req: Request<Body>) -> Self::Future {
        let id = req
            .headers()
            .get(&HEADER)
            .and_then(|v| v.to_str().ok())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        if let Ok(value) = HeaderValue::from_str(&id) {
            req.headers_mut().insert(HEADER.clone(), value);
        }

        let mut inner = self.inner.clone();
        let id_clone = id.clone();
        Box::pin(async move {
            let id_for_response = id_clone.clone();
            let mut response = REQUEST_ID
                .scope(id_clone, async move { inner.call(req).await })
                .await?;
            if let Ok(value) = HeaderValue::from_str(&id_for_response) {
                response.headers_mut().insert(HEADER.clone(), value);
            }
            Ok(response)
        })
    }
}

mod futures_compat {
    use std::future::Future;
    use std::pin::Pin;

    pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    fn app() -> Router {
        Router::new()
            .route(
                "/echo",
                get(|| async {
                    let id = RequestId::current().unwrap_or_default();
                    (StatusCode::OK, id)
                }),
            )
            .layer(RequestIdLayer)
    }

    #[tokio::test]
    async fn generates_request_id_when_absent() {
        let resp = app()
            .oneshot(Request::builder().uri("/echo").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let header = resp
            .headers()
            .get(&HEADER)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(!header.is_empty());
        let body = axum::body::to_bytes(resp.into_body(), 1024).await.unwrap();
        assert_eq!(String::from_utf8(body.to_vec()).unwrap(), header);
        assert!(Uuid::parse_str(&header).is_ok());
    }

    #[tokio::test]
    async fn preserves_incoming_request_id() {
        let resp = app()
            .oneshot(
                Request::builder()
                    .uri("/echo")
                    .header(HEADER_NAME, "trace-abc-123")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.headers().get(&HEADER).unwrap(), "trace-abc-123");
        let body = axum::body::to_bytes(resp.into_body(), 1024).await.unwrap();
        assert_eq!(String::from_utf8(body.to_vec()).unwrap(), "trace-abc-123");
    }

    #[tokio::test]
    async fn empty_incoming_id_is_replaced() {
        let resp = app()
            .oneshot(
                Request::builder()
                    .uri("/echo")
                    .header(HEADER_NAME, "")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let header = resp.headers().get(&HEADER).unwrap().to_str().unwrap();
        assert!(Uuid::parse_str(header).is_ok());
    }

    #[test]
    fn current_is_none_outside_scope() {
        assert!(RequestId::current().is_none());
    }
}
