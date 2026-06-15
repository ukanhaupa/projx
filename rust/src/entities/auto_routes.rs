use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use serde_json::Value;
use tracing::warn;

use crate::entities::query::ListParams;
use crate::entities::types::EntityConfig;
use crate::error::AppError;
use crate::middleware::request_id::RequestId;

const MAX_BULK: usize = 100;

#[derive(Clone)]
pub struct EntityState {
    pub db: Arc<DatabaseConnection>,
    pub cfg: Arc<EntityConfig>,
}

pub fn mount_entity(router: Router, db: Arc<DatabaseConnection>, cfg: Arc<EntityConfig>) -> Router {
    if let Err(e) = cfg.validate() {
        panic!("mount_entity({}): {}", cfg.name, e);
    }
    let base = format!("/api/v1{}", cfg.base_path);
    let id_path = format!("{}/:id", base);
    let bulk_path = format!("{}/bulk", base);

    let state = EntityState { db, cfg };

    let sub: Router = Router::new()
        .route(&base, get(list_handler).post(create_handler))
        .route(
            &bulk_path,
            post(bulk_create_handler).delete(bulk_delete_handler),
        )
        .route(
            &id_path,
            get(get_handler)
                .patch(update_handler)
                .delete(delete_handler),
        )
        .with_state(state);

    router.merge(sub)
}

async fn list_handler(
    State(state): State<EntityState>,
    Query(qs): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let _ = headers;
    let params = ListParams::parse(&qs);
    tracing::debug!(
        request_id = ?RequestId::current(),
        entity = state.cfg.name,
        "list"
    );
    let mut result = state
        .cfg
        .handler
        .list(&state.db, &params, &state.cfg)
        .await?;
    state.cfg.strip_hidden(&mut result.data);
    Ok((StatusCode::OK, Json(result)).into_response())
}

async fn get_handler(
    State(state): State<EntityState>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let mut record = state
        .cfg
        .handler
        .get_by_id(&state.db, &id, &state.cfg)
        .await?;
    state.cfg.strip_hidden(&mut record);
    Ok((StatusCode::OK, Json(record)).into_response())
}

async fn create_handler(
    State(state): State<EntityState>,
    headers: HeaderMap,
    Json(mut payload): Json<Value>,
) -> Result<Response, AppError> {
    if !payload.is_object() {
        return Err(AppError::Validation(
            "request body must be a JSON object".into(),
        ));
    }
    if let Some(hook) = state.cfg.hooks.before_create.clone() {
        hook(&headers, &mut payload).await?;
    }
    let mut record = state
        .cfg
        .handler
        .create(&state.db, payload, &state.cfg)
        .await?;
    if let Some(hook) = state.cfg.hooks.after_create.clone() {
        if let Err(e) = hook(&headers, &record).await {
            warn!(
                request_id = ?RequestId::current(),
                entity = state.cfg.name,
                phase = "after_create",
                error = %e,
                "hook error"
            );
        }
    }
    state.cfg.strip_hidden(&mut record);
    Ok((StatusCode::CREATED, Json(record)).into_response())
}

#[derive(Deserialize)]
struct BulkIdsBody {
    ids: Vec<String>,
}

async fn bulk_create_handler(
    State(state): State<EntityState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Response, AppError> {
    let arr = payload
        .as_array()
        .ok_or_else(|| AppError::Validation("body must be an array".into()))?;
    if arr.is_empty() {
        return Err(AppError::Validation(
            "body must be a non-empty array".into(),
        ));
    }
    if arr.len() > MAX_BULK {
        return Err(AppError::Validation(format!(
            "bulk size exceeds limit of {}",
            MAX_BULK
        )));
    }
    let mut items: Vec<Value> = arr.clone();
    for item in items.iter_mut() {
        if !item.is_object() {
            return Err(AppError::Validation(
                "each item must be a JSON object".into(),
            ));
        }
        if let Some(hook) = state.cfg.hooks.before_create.clone() {
            hook(&headers, item).await?;
        }
    }
    let mut created = state
        .cfg
        .handler
        .bulk_create(&state.db, items, &state.cfg)
        .await?;
    if let Some(hook) = state.cfg.hooks.after_create.clone() {
        for rec in &created {
            if let Err(e) = hook(&headers, rec).await {
                warn!(
                    request_id = ?RequestId::current(),
                    entity = state.cfg.name,
                    phase = "after_create",
                    error = %e,
                    "hook error"
                );
            }
        }
    }
    for rec in created.iter_mut() {
        state.cfg.strip_hidden(rec);
    }
    Ok((StatusCode::CREATED, Json(created)).into_response())
}

async fn update_handler(
    State(state): State<EntityState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Response, AppError> {
    if !payload.is_object() {
        return Err(AppError::Validation(
            "request body must be a JSON object".into(),
        ));
    }
    let updatable = state.cfg.handler.updatable_columns();
    let mut patch = Value::Object(Default::default());
    if let Some(obj) = payload.as_object() {
        let patch_obj = patch.as_object_mut().expect("init object");
        for (k, v) in obj {
            if updatable.contains(&k.as_str()) {
                patch_obj.insert(k.clone(), v.clone());
            }
        }
    }
    if let Some(hook) = state.cfg.hooks.before_update.clone() {
        let short = hook(&headers, &mut patch).await?;
        if short {
            return Ok(StatusCode::NO_CONTENT.into_response());
        }
    }
    let (before, mut after) = state
        .cfg
        .handler
        .update(&state.db, &id, patch, &state.cfg)
        .await?;
    if let Some(hook) = state.cfg.hooks.after_update.clone() {
        if let Err(e) = hook(&headers, &before, &after).await {
            warn!(
                request_id = ?RequestId::current(),
                entity = state.cfg.name,
                phase = "after_update",
                error = %e,
                "hook error"
            );
        }
    }
    state.cfg.strip_hidden(&mut after);
    Ok((StatusCode::OK, Json(after)).into_response())
}

async fn delete_handler(
    State(state): State<EntityState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    if let Some(hook) = state.cfg.hooks.before_delete.clone() {
        hook(&headers, &id).await?;
    }
    let rows = if state.cfg.soft_delete {
        state
            .cfg
            .handler
            .soft_delete(&state.db, &id, &state.cfg)
            .await?
    } else {
        state
            .cfg
            .handler
            .hard_delete(&state.db, &id, &state.cfg)
            .await?
    };
    if rows == 0 {
        return Err(AppError::NotFound(state.cfg.name.to_string()));
    }
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn bulk_delete_handler(
    State(state): State<EntityState>,
    headers: HeaderMap,
    Json(body): Json<BulkIdsBody>,
) -> Result<Response, AppError> {
    if body.ids.is_empty() {
        return Err(AppError::Validation("ids must be a non-empty array".into()));
    }
    if body.ids.len() > MAX_BULK {
        return Err(AppError::Validation(format!(
            "bulk size exceeds limit of {}",
            MAX_BULK
        )));
    }
    if let Some(hook) = state.cfg.hooks.before_delete.clone() {
        for id in &body.ids {
            hook(&headers, id).await?;
        }
    }
    let rows = state
        .cfg
        .handler
        .bulk_delete(&state.db, &body.ids, &state.cfg)
        .await?;
    if rows == 0 {
        return Err(AppError::NotFound(state.cfg.name.to_string()));
    }
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::query::PageResult;
    use crate::entities::types::Hooks;
    use async_trait::async_trait;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use sea_orm::{DatabaseBackend, MockDatabase};
    use serde_json::json;
    use std::sync::Mutex;
    use tower::ServiceExt;

    #[derive(Default)]
    struct FakeHandler {
        store: Mutex<Vec<Value>>,
    }

    #[async_trait]
    impl crate::entities::types::EntityHandler for FakeHandler {
        fn all_columns(&self) -> &'static [&'static str] {
            &["id", "title", "secret"]
        }
        fn updatable_columns(&self) -> &'static [&'static str] {
            &["title"]
        }
        async fn list(
            &self,
            _db: &DatabaseConnection,
            params: &ListParams,
            _cfg: &EntityConfig,
        ) -> Result<PageResult, AppError> {
            let store = self.store.lock().unwrap();
            let filtered: Vec<Value> = store
                .iter()
                .filter(|v| {
                    if let Some(s) = &params.search {
                        v.get("title")
                            .and_then(|t| t.as_str())
                            .map(|t| t.contains(s))
                            .unwrap_or(false)
                    } else {
                        true
                    }
                })
                .cloned()
                .collect();
            let total = filtered.len() as u64;
            let off = params.offset() as usize;
            let end = (off + params.page_size as usize).min(filtered.len());
            let page: Vec<Value> = if off >= filtered.len() {
                vec![]
            } else {
                filtered[off..end].to_vec()
            };
            Ok(PageResult {
                data: Value::Array(page),
                pagination: params.pagination(total),
            })
        }
        async fn get_by_id(
            &self,
            _: &DatabaseConnection,
            id: &str,
            cfg: &EntityConfig,
        ) -> Result<Value, AppError> {
            let store = self.store.lock().unwrap();
            store
                .iter()
                .find(|v| v["id"] == id)
                .cloned()
                .ok_or_else(|| AppError::NotFound(cfg.name.to_string()))
        }
        async fn create(
            &self,
            _: &DatabaseConnection,
            payload: Value,
            _: &EntityConfig,
        ) -> Result<Value, AppError> {
            let title = payload
                .get("title")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::Validation("title required".into()))?
                .to_string();
            let id = format!("id-{}", self.store.lock().unwrap().len() + 1);
            let mut obj = payload.as_object().cloned().unwrap_or_default();
            obj.insert("id".into(), json!(id));
            obj.insert("title".into(), json!(title));
            let v = Value::Object(obj);
            self.store.lock().unwrap().push(v.clone());
            Ok(v)
        }
        async fn update(
            &self,
            _: &DatabaseConnection,
            id: &str,
            patch: Value,
            cfg: &EntityConfig,
        ) -> Result<(Value, Value), AppError> {
            let mut store = self.store.lock().unwrap();
            let idx = store
                .iter()
                .position(|v| v["id"] == id)
                .ok_or_else(|| AppError::NotFound(cfg.name.to_string()))?;
            let before = store[idx].clone();
            if let Some(obj) = patch.as_object() {
                if let Some(target) = store[idx].as_object_mut() {
                    for (k, v) in obj {
                        target.insert(k.clone(), v.clone());
                    }
                }
            }
            Ok((before, store[idx].clone()))
        }
        async fn soft_delete(
            &self,
            _: &DatabaseConnection,
            id: &str,
            _: &EntityConfig,
        ) -> Result<u64, AppError> {
            let mut store = self.store.lock().unwrap();
            if let Some(idx) = store.iter().position(|v| v["id"] == id) {
                if let Some(obj) = store[idx].as_object_mut() {
                    obj.insert("deleted_at".into(), json!("2025-01-01"));
                }
                Ok(1)
            } else {
                Ok(0)
            }
        }
        async fn hard_delete(
            &self,
            _: &DatabaseConnection,
            id: &str,
            _: &EntityConfig,
        ) -> Result<u64, AppError> {
            let mut store = self.store.lock().unwrap();
            let before_len = store.len();
            store.retain(|v| v["id"] != id);
            Ok((before_len - store.len()) as u64)
        }
        async fn bulk_create(
            &self,
            db: &DatabaseConnection,
            payloads: Vec<Value>,
            cfg: &EntityConfig,
        ) -> Result<Vec<Value>, AppError> {
            let mut out = Vec::new();
            for p in payloads {
                out.push(self.create(db, p, cfg).await?);
            }
            Ok(out)
        }
        async fn bulk_delete(
            &self,
            _: &DatabaseConnection,
            ids: &[String],
            _: &EntityConfig,
        ) -> Result<u64, AppError> {
            let mut store = self.store.lock().unwrap();
            let before_len = store.len();
            store.retain(|v| !ids.contains(&v["id"].as_str().unwrap_or("").to_string()));
            Ok((before_len - store.len()) as u64)
        }
    }

    fn mock_db() -> DatabaseConnection {
        MockDatabase::new(DatabaseBackend::Postgres).into_connection()
    }

    fn build_app(soft_delete: bool, hidden: Vec<&'static str>) -> (Router, Arc<EntityConfig>) {
        let cfg = Arc::new(EntityConfig {
            name: "thing",
            base_path: "/things",
            handler: Arc::new(FakeHandler::default()),
            searchable_fields: vec!["title"],
            hidden_fields: hidden,
            soft_delete,
            hooks: Hooks::default(),
        });
        let app = mount_entity(Router::new(), Arc::new(mock_db()), cfg.clone());
        (app, cfg)
    }

    async fn json_body(resp: Response) -> Value {
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    }

    #[tokio::test]
    async fn create_then_get_then_list() {
        let (app, _) = build_app(false, vec![]);
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/things")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"hello"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = json_body(resp).await;
        let id = body["id"].as_str().unwrap().to_string();

        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/things/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/things")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = json_body(resp).await;
        assert_eq!(body["pagination"]["total_records"], 1);
    }

    #[tokio::test]
    async fn create_rejects_non_object() {
        let (app, _) = build_app(false, vec![]);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/things")
                    .header("content-type", "application/json")
                    .body(Body::from("[]"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn get_returns_404_when_missing() {
        let (app, _) = build_app(false, vec![]);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/things/nope")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn update_only_applies_allowlisted_columns() {
        let (app, _) = build_app(false, vec![]);
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/things")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"a"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = json_body(resp).await;
        let id = body["id"].as_str().unwrap().to_string();

        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/v1/things/{id}"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"b","secret":"x"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = json_body(resp).await;
        assert_eq!(body["title"], "b");
        assert!(body.get("secret").is_none() || body["secret"] == Value::Null);
    }

    #[tokio::test]
    async fn delete_returns_204_then_404() {
        let (app, _) = build_app(false, vec![]);
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/things")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"a"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = json_body(resp).await;
        let id = body["id"].as_str().unwrap().to_string();

        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/things/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/things/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn bulk_create_rejects_oversize() {
        let (app, _) = build_app(false, vec![]);
        let big: Vec<Value> = (0..101)
            .map(|i| json!({"title": format!("t{i}")}))
            .collect();
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/things/bulk")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&big).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn bulk_create_succeeds_for_small_batch() {
        let (app, _) = build_app(false, vec![]);
        let batch = json!([{"title":"a"},{"title":"b"}]);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/things/bulk")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&batch).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = json_body(resp).await;
        assert_eq!(body.as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn bulk_delete_404_when_no_match() {
        let (app, _) = build_app(false, vec![]);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/api/v1/things/bulk")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"ids":["nope"]}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn list_search_filters_by_title() {
        let (app, _) = build_app(false, vec![]);
        for t in ["alpha", "beta", "alphabet"] {
            app.clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/v1/things")
                        .header("content-type", "application/json")
                        .body(Body::from(format!(r#"{{"title":"{t}"}}"#)))
                        .unwrap(),
                )
                .await
                .unwrap();
        }
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/things?search=alpha")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = json_body(resp).await;
        assert_eq!(body["pagination"]["total_records"], 2);
    }

    #[tokio::test]
    async fn hidden_fields_stripped_from_response() {
        let (app, _) = build_app(false, vec!["secret"]);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/things")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"a","secret":"sshh"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = json_body(resp).await;
        assert!(body.get("secret").is_none());
    }

    fn app_with_hooks(hooks: Hooks) -> Router {
        let cfg = Arc::new(EntityConfig {
            name: "thing",
            base_path: "/things",
            handler: Arc::new(FakeHandler::default()),
            searchable_fields: vec!["title"],
            hidden_fields: vec![],
            soft_delete: false,
            hooks,
        });
        mount_entity(Router::new(), Arc::new(mock_db()), cfg)
    }

    async fn create_thing(app: &Router, body: &str) -> Response {
        app.clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/things")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_owned()))
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn before_create_hook_mutates_payload() {
        let mut hooks = Hooks::default();
        hooks.before_create = Some(Arc::new(|_headers, payload| {
            Box::pin(async move {
                if let Some(obj) = payload.as_object_mut() {
                    obj.insert("title".into(), json!("rewritten"));
                }
                Ok(())
            })
        }));
        let app = app_with_hooks(hooks);
        let resp = create_thing(&app, r#"{"title":"original"}"#).await;
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = json_body(resp).await;
        assert_eq!(body["title"], "rewritten");
    }

    #[tokio::test]
    async fn before_create_hook_error_aborts() {
        let mut hooks = Hooks::default();
        hooks.before_create = Some(Arc::new(|_headers, _payload| {
            Box::pin(async move { Err(AppError::Forbidden("nope".into())) })
        }));
        let app = app_with_hooks(hooks);
        let resp = create_thing(&app, r#"{"title":"x"}"#).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn after_create_hook_error_is_swallowed() {
        let mut hooks = Hooks::default();
        hooks.after_create = Some(Arc::new(|_headers, _record| {
            Box::pin(async move { Err(AppError::Internal(anyhow::anyhow!("boom"))) })
        }));
        let app = app_with_hooks(hooks);
        let resp = create_thing(&app, r#"{"title":"persisted"}"#).await;
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = json_body(resp).await;
        assert_eq!(body["title"], "persisted");
    }

    #[tokio::test]
    async fn before_update_hook_short_circuits() {
        let create_hooks = Hooks::default();
        let app = app_with_hooks(create_hooks);
        let created = create_thing(&app, r#"{"title":"a"}"#).await;
        let id = json_body(created).await["id"].as_str().unwrap().to_string();

        let mut hooks = Hooks::default();
        hooks.before_update = Some(Arc::new(|_headers, _patch| {
            Box::pin(async move { Ok(true) })
        }));
        let app2 = Router::new();
        let cfg = Arc::new(EntityConfig {
            name: "thing",
            base_path: "/things",
            handler: Arc::new(FakeHandler::default()),
            searchable_fields: vec!["title"],
            hidden_fields: vec![],
            soft_delete: false,
            hooks,
        });
        let app2 = mount_entity(app2, Arc::new(mock_db()), cfg);
        let resp = app2
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/v1/things/{id}"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"b"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn after_update_hook_error_is_swallowed() {
        let mut hooks = Hooks::default();
        hooks.after_update = Some(Arc::new(|_headers, _before, _after| {
            Box::pin(async move { Err(AppError::Internal(anyhow::anyhow!("late"))) })
        }));
        let app = app_with_hooks(hooks);
        let created = create_thing(&app, r#"{"title":"a"}"#).await;
        let id = json_body(created).await["id"].as_str().unwrap().to_string();
        let resp = app
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/v1/things/{id}"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"b"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = json_body(resp).await;
        assert_eq!(body["title"], "b");
    }

    #[tokio::test]
    async fn before_delete_hook_aborts() {
        let mut hooks = Hooks::default();
        hooks.before_delete = Some(Arc::new(|_headers, _id| {
            Box::pin(async move { Err(AppError::Forbidden("locked".into())) })
        }));
        let app = app_with_hooks(hooks);
        let created = create_thing(&app, r#"{"title":"a"}"#).await;
        let id = json_body(created).await["id"].as_str().unwrap().to_string();
        let resp = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/things/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn update_rejects_non_object_body() {
        let (app, _) = build_app(false, vec![]);
        let created = create_thing(&app, r#"{"title":"a"}"#).await;
        let id = json_body(created).await["id"].as_str().unwrap().to_string();
        let resp = app
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/v1/things/{id}"))
                    .header("content-type", "application/json")
                    .body(Body::from("[]"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn bulk_create_rejects_empty_array() {
        let (app, _) = build_app(false, vec![]);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/things/bulk")
                    .header("content-type", "application/json")
                    .body(Body::from("[]"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn bulk_create_rejects_non_object_item() {
        let (app, _) = build_app(false, vec![]);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/things/bulk")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"[123]"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn bulk_delete_rejects_empty_ids() {
        let (app, _) = build_app(false, vec![]);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/api/v1/things/bulk")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"ids":[]}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn bulk_delete_rejects_oversize() {
        let (app, _) = build_app(false, vec![]);
        let ids: Vec<String> = (0..101).map(|i| format!("id-{i}")).collect();
        let body = json!({ "ids": ids });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/api/v1/things/bulk")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn bulk_delete_succeeds_for_existing() {
        let (app, _) = build_app(false, vec![]);
        let mut ids = Vec::new();
        for t in ["a", "b"] {
            let created = create_thing(&app, &format!(r#"{{"title":"{t}"}}"#)).await;
            ids.push(json_body(created).await["id"].as_str().unwrap().to_string());
        }
        let body = json!({ "ids": ids });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/api/v1/things/bulk")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn soft_delete_path_returns_204() {
        let (app, _) = build_app(true, vec![]);
        let created = create_thing(&app, r#"{"title":"a"}"#).await;
        let id = json_body(created).await["id"].as_str().unwrap().to_string();
        let resp = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/things/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    }
}
