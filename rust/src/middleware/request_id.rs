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
