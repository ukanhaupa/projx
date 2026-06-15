use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{Request, State},
    http::HeaderValue,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use tokio::sync::Mutex;
use tokio::time::Instant;

use crate::auth::AuthUser;

pub type KeyFn = Arc<dyn Fn(&Request) -> String + Send + Sync>;

#[derive(Clone)]
pub struct RateLimitOptions {
    pub key_fn: KeyFn,
    pub capacity: u32,
    pub refill_per_sec: f64,
}

#[derive(Clone)]
pub struct RateLimiter {
    inner: Arc<Inner>,
}

struct Inner {
    capacity: f64,
    refill_per_sec: f64,
    buckets: Mutex<HashMap<String, Bucket>>,
    opts: RateLimitOptions,
}

#[derive(Clone, Copy)]
struct Bucket {
    tokens: f64,
    last_seen: Instant,
}

impl RateLimiter {
    pub fn new(opts: RateLimitOptions) -> Self {
        assert!(opts.capacity > 0, "ratelimit: capacity must be > 0");
        assert!(
            opts.refill_per_sec > 0.0,
            "ratelimit: refill_per_sec must be > 0"
        );
        Self {
            inner: Arc::new(Inner {
                capacity: opts.capacity as f64,
                refill_per_sec: opts.refill_per_sec,
                buckets: Mutex::new(HashMap::new()),
                opts,
            }),
        }
    }

    pub fn per_user() -> Self {
        Self::new(RateLimitOptions {
            key_fn: Arc::new(|req: &Request| {
                req.extensions()
                    .get::<AuthUser>()
                    .map(|u| u.id.clone())
                    .unwrap_or_default()
            }),
            capacity: 120,
            refill_per_sec: 1.0,
        })
    }

    pub async fn allow(&self, key: &str) -> (bool, f64, Duration) {
        let mut buckets = self.inner.buckets.lock().await;
        let now = Instant::now();
        let b = buckets.entry(key.to_string()).or_insert(Bucket {
            tokens: self.inner.capacity,
            last_seen: now,
        });
        let elapsed = now.duration_since(b.last_seen).as_secs_f64();
        if elapsed > 0.0 {
            b.tokens = (b.tokens + elapsed * self.inner.refill_per_sec).min(self.inner.capacity);
        }
        b.last_seen = now;
        if b.tokens < 1.0 {
            let need = 1.0 - b.tokens;
            let retry_secs = need / self.inner.refill_per_sec;
            return (
                false,
                0.0,
                Duration::from_millis((retry_secs * 1000.0) as u64),
            );
        }
        b.tokens -= 1.0;
        (true, b.tokens, Duration::ZERO)
    }

    pub fn capacity(&self) -> u32 {
        self.inner.capacity as u32
    }

    pub fn key_for(&self, req: &Request) -> String {
        (self.inner.opts.key_fn)(req)
    }
}

#[tracing::instrument(skip(limiter, req, next))]
pub async fn ratelimit_mw(
    State(limiter): State<RateLimiter>,
    req: Request,
    next: Next,
) -> Response {
    let key = limiter.key_for(&req);
    if key.is_empty() {
        return next.run(req).await;
    }
    let limit = limiter.capacity();
    let (allowed, remaining, retry) = limiter.allow(&key).await;
    if !allowed {
        let mut resp = (
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"detail": "rate limit exceeded"})),
        )
            .into_response();
        set_headers(&mut resp, limit, 0);
        let retry_secs = retry.as_secs_f64().ceil() as u64;
        if let Ok(v) = HeaderValue::from_str(&retry_secs.to_string()) {
            resp.headers_mut().insert("retry-after", v);
        }
        return resp;
    }
    let mut resp = next.run(req).await;
    set_headers(&mut resp, limit, remaining.floor() as i64);
    resp
}

fn set_headers(resp: &mut Response, limit: u32, remaining: i64) {
    let h = resp.headers_mut();
    if let Ok(v) = HeaderValue::from_str(&limit.to_string()) {
        h.insert("x-ratelimit-limit", v);
    }
    if let Ok(v) = HeaderValue::from_str(&remaining.max(0).to_string()) {
        h.insert("x-ratelimit-remaining", v);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limiter_with(capacity: u32, refill: f64) -> RateLimiter {
        RateLimiter::new(RateLimitOptions {
            key_fn: Arc::new(|_| "k".into()),
            capacity,
            refill_per_sec: refill,
        })
    }

    #[tokio::test]
    async fn allow_within_capacity() {
        let l = limiter_with(3, 1.0);
        for _ in 0..3 {
            let (ok, _, _) = l.allow("u").await;
            assert!(ok);
        }
        let (ok, _, retry) = l.allow("u").await;
        assert!(!ok);
        assert!(retry.as_millis() > 0);
    }

    #[tokio::test]
    async fn refill_grants_after_wait() {
        let l = limiter_with(1, 100.0);
        let (ok1, _, _) = l.allow("u").await;
        assert!(ok1);
        let (ok2, _, _) = l.allow("u").await;
        assert!(!ok2);
        tokio::time::sleep(Duration::from_millis(50)).await;
        let (ok3, _, _) = l.allow("u").await;
        assert!(ok3);
    }

    #[tokio::test]
    async fn separate_keys_independent() {
        let l = limiter_with(1, 0.001);
        assert!(l.allow("a").await.0);
        assert!(l.allow("b").await.0);
        assert!(!l.allow("a").await.0);
    }

    #[tokio::test]
    async fn per_user_uses_extension() {
        let l = RateLimiter::per_user();
        let mut req = Request::new(axum::body::Body::empty());
        req.extensions_mut().insert(AuthUser {
            id: "u1".into(),
            email: String::new(),
            role: String::new(),
            permissions: vec![],
            sid: String::new(),
        });
        let key = l.key_for(&req);
        assert_eq!(key, "u1");
    }

    #[tokio::test]
    async fn empty_key_returns_empty_when_no_user() {
        let l = RateLimiter::per_user();
        let req = Request::new(axum::body::Body::empty());
        assert_eq!(l.key_for(&req), "");
    }

    #[test]
    fn set_headers_writes_both() {
        let mut resp: Response = (axum::http::StatusCode::OK, "x").into_response();
        set_headers(&mut resp, 60, 30);
        assert_eq!(resp.headers().get("x-ratelimit-limit").unwrap(), "60");
        assert_eq!(resp.headers().get("x-ratelimit-remaining").unwrap(), "30");
    }

    #[test]
    fn capacity_accessor() {
        let l = limiter_with(42, 1.0);
        assert_eq!(l.capacity(), 42);
    }

    #[test]
    #[should_panic(expected = "capacity must be > 0")]
    fn new_panics_on_zero_capacity() {
        limiter_with(0, 1.0);
    }

    #[test]
    #[should_panic(expected = "refill_per_sec must be > 0")]
    fn new_panics_on_zero_refill() {
        limiter_with(1, 0.0);
    }

    #[tokio::test]
    async fn allow_reports_remaining_tokens() {
        let l = limiter_with(5, 0.001);
        let (ok, remaining, retry) = l.allow("u").await;
        assert!(ok);
        assert_eq!(remaining, 4.0);
        assert_eq!(retry, Duration::ZERO);
    }

    mod middleware {
        use super::super::*;
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use axum::routing::get;
        use axum::Router;
        use std::sync::Arc;
        use tower::ServiceExt;

        fn app(limiter: RateLimiter) -> Router {
            Router::new()
                .route("/ping", get(|| async { "pong" }))
                .layer(axum::middleware::from_fn_with_state(limiter, ratelimit_mw))
        }

        fn fixed_key_limiter(capacity: u32, refill: f64) -> RateLimiter {
            RateLimiter::new(RateLimitOptions {
                key_fn: Arc::new(|_| "fixed".into()),
                capacity,
                refill_per_sec: refill,
            })
        }

        #[tokio::test]
        async fn allowed_request_sets_ratelimit_headers() {
            let app = app(fixed_key_limiter(10, 1.0));
            let resp = app
                .oneshot(Request::builder().uri("/ping").body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::OK);
            assert_eq!(resp.headers().get("x-ratelimit-limit").unwrap(), "10");
            assert_eq!(resp.headers().get("x-ratelimit-remaining").unwrap(), "9");
        }

        #[tokio::test]
        async fn exhausted_bucket_returns_429_with_retry_after() {
            let limiter = fixed_key_limiter(1, 0.001);
            let app = app(limiter);
            let first = app
                .clone()
                .oneshot(Request::builder().uri("/ping").body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(first.status(), StatusCode::OK);
            let second = app
                .oneshot(Request::builder().uri("/ping").body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(second.status(), StatusCode::TOO_MANY_REQUESTS);
            assert_eq!(second.headers().get("x-ratelimit-remaining").unwrap(), "0");
            assert!(second.headers().get("retry-after").is_some());
        }

        #[tokio::test]
        async fn empty_key_bypasses_limit() {
            let limiter = RateLimiter::new(RateLimitOptions {
                key_fn: Arc::new(|_| String::new()),
                capacity: 1,
                refill_per_sec: 0.001,
            });
            let app = app(limiter);
            for _ in 0..3 {
                let resp = app
                    .clone()
                    .oneshot(Request::builder().uri("/ping").body(Body::empty()).unwrap())
                    .await
                    .unwrap();
                assert_eq!(resp.status(), StatusCode::OK);
                assert!(resp.headers().get("x-ratelimit-limit").is_none());
            }
        }
    }
}
