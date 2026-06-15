use std::collections::HashMap;

use axum::{response::IntoResponse, routing::get, Json, Router};
use serde::Serialize;

use crate::entities;
use crate::entities::types::EntityConfig;
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
pub struct FieldSchema {
    pub name: String,
    pub json_name: String,
    pub db_name: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub nullable: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub primary_key: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub unique: bool,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Debug, Clone, Serialize)]
pub struct EntitySchema {
    pub name: String,
    pub table_name: String,
    pub base_path: String,
    pub api_path: String,
    pub soft_delete: bool,
    pub searchable_fields: Vec<String>,
    pub hidden_fields: Vec<String>,
    pub fields: Vec<FieldSchema>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchemasResponse {
    pub entities: HashMap<String, EntitySchema>,
}

pub fn routes() -> Router {
    Router::new().route("/schemas", get(get_schemas))
}

#[tracing::instrument]
pub async fn get_schemas() -> AppResult<impl IntoResponse> {
    let cfgs = entities::all();
    let body = build(cfgs.iter().map(|c| c.as_ref()));
    Ok(Json(body))
}

pub fn build<'a, I: IntoIterator<Item = &'a EntityConfig>>(cfgs: I) -> SchemasResponse {
    let mut out = SchemasResponse {
        entities: HashMap::new(),
    };
    for cfg in cfgs {
        let hidden: std::collections::HashSet<&str> = cfg.hidden_fields.iter().copied().collect();
        let fields = cfg
            .handler
            .all_columns()
            .iter()
            .filter(|col| !hidden.contains(*col))
            .map(|col| FieldSchema {
                name: col.to_string(),
                json_name: col.to_string(),
                db_name: col.to_string(),
                field_type: "unknown".to_string(),
                nullable: !matches!(*col, "id" | "created_at"),
                primary_key: *col == cfg.handler.primary_key(),
                unique: *col == cfg.handler.primary_key(),
            })
            .collect();
        let entity = EntitySchema {
            name: cfg.name.to_string(),
            table_name: cfg.name.to_string(),
            base_path: cfg.base_path.to_string(),
            api_path: format!("/api/v1{}", cfg.base_path),
            soft_delete: cfg.soft_delete,
            searchable_fields: cfg
                .searchable_fields
                .iter()
                .map(|s| s.to_string())
                .collect(),
            hidden_fields: cfg.hidden_fields.iter().map(|s| s.to_string()).collect(),
            fields,
        };
        out.entities.insert(entity.name.clone(), entity);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::query::{ListParams, PageResult};
    use crate::entities::types::{EntityHandler, Hooks};
    use crate::error::AppError as EAppError;
    use async_trait::async_trait;
    use sea_orm::DatabaseConnection;
    use serde_json::Value;
    use std::sync::Arc;

    struct Stub {
        cols: &'static [&'static str],
    }

    #[async_trait]
    impl EntityHandler for Stub {
        fn all_columns(&self) -> &'static [&'static str] {
            self.cols
        }
        fn updatable_columns(&self) -> &'static [&'static str] {
            &[]
        }
        async fn list(
            &self,
            _: &DatabaseConnection,
            _: &ListParams,
            _: &EntityConfig,
        ) -> Result<PageResult, EAppError> {
            unreachable!()
        }
        async fn get_by_id(
            &self,
            _: &DatabaseConnection,
            _: &str,
            _: &EntityConfig,
        ) -> Result<Value, EAppError> {
            unreachable!()
        }
        async fn create(
            &self,
            _: &DatabaseConnection,
            _: Value,
            _: &EntityConfig,
        ) -> Result<Value, EAppError> {
            unreachable!()
        }
        async fn update(
            &self,
            _: &DatabaseConnection,
            _: &str,
            _: Value,
            _: &EntityConfig,
        ) -> Result<(Value, Value), EAppError> {
            unreachable!()
        }
        async fn soft_delete(
            &self,
            _: &DatabaseConnection,
            _: &str,
            _: &EntityConfig,
        ) -> Result<u64, EAppError> {
            unreachable!()
        }
        async fn hard_delete(
            &self,
            _: &DatabaseConnection,
            _: &str,
            _: &EntityConfig,
        ) -> Result<u64, EAppError> {
            unreachable!()
        }
        async fn bulk_create(
            &self,
            _: &DatabaseConnection,
            _: Vec<Value>,
            _: &EntityConfig,
        ) -> Result<Vec<Value>, EAppError> {
            unreachable!()
        }
        async fn bulk_delete(
            &self,
            _: &DatabaseConnection,
            _: &[String],
            _: &EntityConfig,
        ) -> Result<u64, EAppError> {
            unreachable!()
        }
    }

    fn cfg(name: &'static str, path: &'static str, cols: &'static [&'static str]) -> EntityConfig {
        EntityConfig {
            name,
            base_path: path,
            handler: Arc::new(Stub { cols }),
            searchable_fields: vec!["title"],
            hidden_fields: vec!["password"],
            soft_delete: true,
            hooks: Hooks::default(),
        }
    }

    #[test]
    fn build_wraps_api_path() {
        let c = cfg("post", "/posts", &["id", "title"]);
        let r = build(std::iter::once(&c));
        assert_eq!(r.entities["post"].api_path, "/api/v1/posts");
    }

    #[test]
    fn build_filters_hidden_fields() {
        let c = cfg("post", "/posts", &["id", "password", "title"]);
        let r = build(std::iter::once(&c));
        let names: Vec<&str> = r.entities["post"]
            .fields
            .iter()
            .map(|f| f.name.as_str())
            .collect();
        assert!(!names.contains(&"password"));
        assert!(names.contains(&"id"));
        assert!(names.contains(&"title"));
    }

    #[test]
    fn build_preserves_metadata() {
        let c = cfg("post", "/posts", &["id"]);
        let r = build(std::iter::once(&c));
        let e = &r.entities["post"];
        assert_eq!(e.searchable_fields, vec!["title"]);
        assert_eq!(e.hidden_fields, vec!["password"]);
        assert!(e.soft_delete);
    }

    #[test]
    fn build_marks_primary_key() {
        let c = cfg("post", "/posts", &["id", "title"]);
        let r = build(std::iter::once(&c));
        let id_field = r.entities["post"]
            .fields
            .iter()
            .find(|f| f.name == "id")
            .unwrap();
        assert!(id_field.primary_key);
    }

    #[test]
    fn primary_key_serializes_only_when_true() {
        let f = FieldSchema {
            name: "x".into(),
            json_name: "x".into(),
            db_name: "x".into(),
            field_type: "i32".into(),
            nullable: true,
            primary_key: false,
            unique: false,
        };
        let v = serde_json::to_value(&f).unwrap();
        assert!(v.get("primary_key").is_none());
        assert!(v.get("unique").is_none());
    }

    #[test]
    fn build_marks_id_and_created_at_non_nullable() {
        let c = cfg("post", "/posts", &["id", "created_at", "title"]);
        let r = build(std::iter::once(&c));
        let fields = &r.entities["post"].fields;
        let by = |n: &str| fields.iter().find(|f| f.name == n).unwrap();
        assert!(!by("id").nullable);
        assert!(!by("created_at").nullable);
        assert!(by("title").nullable);
    }

    #[test]
    fn build_handles_multiple_entities() {
        let a = cfg("post", "/posts", &["id"]);
        let b = cfg("tag", "/tags", &["id"]);
        let r = build([&a, &b]);
        assert_eq!(r.entities.len(), 2);
        assert_eq!(r.entities["tag"].api_path, "/api/v1/tags");
    }

    mod http {
        use super::super::*;
        use crate::entities;
        use crate::entities::registry::TEST_REGISTRY_LOCK as REGISTRY_LOCK;
        use axum::body::{to_bytes, Body};
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;

        #[tokio::test]
        async fn schemas_endpoint_returns_registered_entities() {
            let _g = REGISTRY_LOCK.lock().await;
            entities::reset();
            entities::register(crate::posts::config());
            let app = routes();
            let resp = app
                .oneshot(
                    Request::builder()
                        .uri("/schemas")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::OK);
            let bytes = to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
            let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(v["entities"]["post"]["api_path"], "/api/v1/posts");
            assert!(v["entities"]["post"]["fields"].is_array());
            entities::reset();
        }

        #[tokio::test]
        async fn schemas_endpoint_empty_registry() {
            let _g = REGISTRY_LOCK.lock().await;
            entities::reset();
            let app = routes();
            let resp = app
                .oneshot(
                    Request::builder()
                        .uri("/schemas")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::OK);
            let bytes = to_bytes(resp.into_body(), 1024).await.unwrap();
            let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(v["entities"].as_object().unwrap().len(), 0);
        }
    }
}
