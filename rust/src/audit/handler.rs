use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::DatabaseConnection;
use serde_json::Value;

use crate::audit::writer::{self, DELETE, INSERT, UPDATE};
use crate::entities::query::{ListParams, PageResult};
use crate::entities::types::{EntityConfig, EntityHandler};
use crate::error::AppError;

pub struct AuditHandler {
    inner: Arc<dyn EntityHandler>,
}

impl AuditHandler {
    pub fn wrap(inner: Arc<dyn EntityHandler>) -> Arc<dyn EntityHandler> {
        Arc::new(Self { inner })
    }

    fn record_id(value: &Value, pk: &str) -> String {
        value
            .get(pk)
            .map(stringify_id)
            .unwrap_or_default()
            .unwrap_or_default()
    }

    async fn pre_image(
        &self,
        db: &DatabaseConnection,
        id: &str,
        cfg: &EntityConfig,
    ) -> Option<Value> {
        self.inner.get_by_id(db, id, cfg).await.ok()
    }
}

fn stringify_id(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Null => None,
        other => Some(other.to_string()),
    }
}

#[async_trait]
impl EntityHandler for AuditHandler {
    fn all_columns(&self) -> &'static [&'static str] {
        self.inner.all_columns()
    }
    fn updatable_columns(&self) -> &'static [&'static str] {
        self.inner.updatable_columns()
    }
    fn primary_key(&self) -> &'static str {
        self.inner.primary_key()
    }

    async fn list(
        &self,
        db: &DatabaseConnection,
        params: &ListParams,
        cfg: &EntityConfig,
    ) -> Result<PageResult, AppError> {
        self.inner.list(db, params, cfg).await
    }

    async fn get_by_id(
        &self,
        db: &DatabaseConnection,
        id: &str,
        cfg: &EntityConfig,
    ) -> Result<Value, AppError> {
        self.inner.get_by_id(db, id, cfg).await
    }

    async fn create(
        &self,
        db: &DatabaseConnection,
        payload: Value,
        cfg: &EntityConfig,
    ) -> Result<Value, AppError> {
        let created = self.inner.create(db, payload, cfg).await?;
        let id = Self::record_id(&created, self.primary_key());
        writer::write(db, cfg.name, id, INSERT, None, Some(created.clone())).await;
        Ok(created)
    }

    async fn update(
        &self,
        db: &DatabaseConnection,
        id: &str,
        patch: Value,
        cfg: &EntityConfig,
    ) -> Result<(Value, Value), AppError> {
        let (before, after) = self.inner.update(db, id, patch, cfg).await?;
        let rid = Self::record_id(&after, self.primary_key());
        writer::write(
            db,
            cfg.name,
            rid,
            UPDATE,
            Some(before.clone()),
            Some(after.clone()),
        )
        .await;
        Ok((before, after))
    }

    async fn soft_delete(
        &self,
        db: &DatabaseConnection,
        id: &str,
        cfg: &EntityConfig,
    ) -> Result<u64, AppError> {
        let before = self.pre_image(db, id, cfg).await;
        let rows = self.inner.soft_delete(db, id, cfg).await?;
        if rows > 0 {
            let rid = before
                .as_ref()
                .map(|v| Self::record_id(v, self.primary_key()))
                .unwrap_or_else(|| id.to_string());
            writer::write(db, cfg.name, rid, DELETE, before, None).await;
        }
        Ok(rows)
    }

    async fn hard_delete(
        &self,
        db: &DatabaseConnection,
        id: &str,
        cfg: &EntityConfig,
    ) -> Result<u64, AppError> {
        let before = self.pre_image(db, id, cfg).await;
        let rows = self.inner.hard_delete(db, id, cfg).await?;
        if rows > 0 {
            let rid = before
                .as_ref()
                .map(|v| Self::record_id(v, self.primary_key()))
                .unwrap_or_else(|| id.to_string());
            writer::write(db, cfg.name, rid, DELETE, before, None).await;
        }
        Ok(rows)
    }

    async fn bulk_create(
        &self,
        db: &DatabaseConnection,
        payloads: Vec<Value>,
        cfg: &EntityConfig,
    ) -> Result<Vec<Value>, AppError> {
        let created = self.inner.bulk_create(db, payloads, cfg).await?;
        for record in &created {
            let rid = Self::record_id(record, self.primary_key());
            writer::write(db, cfg.name, rid, INSERT, None, Some(record.clone())).await;
        }
        Ok(created)
    }

    async fn bulk_delete(
        &self,
        db: &DatabaseConnection,
        ids: &[String],
        cfg: &EntityConfig,
    ) -> Result<u64, AppError> {
        let mut pre_images = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(before) = self.pre_image(db, id, cfg).await {
                pre_images.push((id.clone(), before));
            }
        }
        let rows = self.inner.bulk_delete(db, ids, cfg).await?;
        if rows > 0 {
            for (id, before) in pre_images {
                let rid = Self::record_id(&before, self.primary_key());
                let rid = if rid.is_empty() { id } else { rid };
                writer::write(db, cfg.name, rid, DELETE, Some(before), None).await;
            }
        }
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::types::Hooks;
    use sea_orm::{DatabaseBackend, MockDatabase};
    use serde_json::json;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeInner {
        store: Mutex<Vec<Value>>,
    }

    #[async_trait]
    impl EntityHandler for FakeInner {
        fn all_columns(&self) -> &'static [&'static str] {
            &["id", "title"]
        }
        fn updatable_columns(&self) -> &'static [&'static str] {
            &["title"]
        }
        async fn list(
            &self,
            _: &DatabaseConnection,
            _: &ListParams,
            _: &EntityConfig,
        ) -> Result<PageResult, AppError> {
            unreachable!()
        }
        async fn get_by_id(
            &self,
            _: &DatabaseConnection,
            id: &str,
            cfg: &EntityConfig,
        ) -> Result<Value, AppError> {
            self.store
                .lock()
                .unwrap()
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
            let mut store = self.store.lock().unwrap();
            let id = format!("id-{}", store.len() + 1);
            let mut obj = payload.as_object().cloned().unwrap_or_default();
            obj.insert("id".into(), json!(id));
            let v = Value::Object(obj);
            store.push(v.clone());
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
            if let (Some(obj), Some(target)) = (patch.as_object(), store[idx].as_object_mut()) {
                for (k, val) in obj {
                    target.insert(k.clone(), val.clone());
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
            let before = store.len();
            store.retain(|v| v["id"] != id);
            Ok((before - store.len()) as u64)
        }
        async fn hard_delete(
            &self,
            db: &DatabaseConnection,
            id: &str,
            cfg: &EntityConfig,
        ) -> Result<u64, AppError> {
            self.soft_delete(db, id, cfg).await
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
            let before = store.len();
            store.retain(|v| !ids.contains(&v["id"].as_str().unwrap_or("").to_string()));
            Ok((before - store.len()) as u64)
        }
    }

    fn cfg(inner: Arc<dyn EntityHandler>) -> EntityConfig {
        EntityConfig {
            name: "thing",
            base_path: "/things",
            handler: inner,
            searchable_fields: vec![],
            hidden_fields: vec![],
            soft_delete: false,
            hooks: Hooks::default(),
        }
    }

    fn audit_db(rows_to_capture: usize) -> DatabaseConnection {
        let mut db = MockDatabase::new(DatabaseBackend::Postgres);
        for _ in 0..rows_to_capture {
            db = db.append_exec_results([sea_orm::MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }]);
        }
        db.into_connection()
    }

    #[test]
    fn record_id_handles_string_number_null() {
        assert_eq!(
            AuditHandler::record_id(&json!({"id": "abc"}), "id"),
            "abc".to_string()
        );
        assert_eq!(
            AuditHandler::record_id(&json!({"id": 7}), "id"),
            "7".to_string()
        );
        assert_eq!(AuditHandler::record_id(&json!({"id": null}), "id"), "");
        assert_eq!(AuditHandler::record_id(&json!({}), "id"), "");
    }

    #[test]
    fn stringify_id_covers_bool_and_array_fallback() {
        assert_eq!(stringify_id(&json!(true)), Some("true".to_string()));
        assert_eq!(stringify_id(&json!([1, 2])), Some("[1,2]".to_string()));
        assert_eq!(stringify_id(&Value::Null), None);
    }

    #[tokio::test]
    async fn delegates_column_accessors() {
        let inner = Arc::new(FakeInner::default());
        let handler = AuditHandler {
            inner: inner.clone(),
        };
        assert_eq!(handler.all_columns(), &["id", "title"]);
        assert_eq!(handler.updatable_columns(), &["title"]);
        assert_eq!(handler.primary_key(), "id");
    }

    #[tokio::test]
    async fn delegates_read_methods() {
        let inner = Arc::new(FakeInner::default());
        let handler = AuditHandler {
            inner: inner.clone(),
        };
        let c = cfg(inner);
        let db = audit_db(0);
        let err = handler.get_by_id(&db, "missing", &c).await.unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[tokio::test]
    async fn create_returns_record_and_attempts_audit() {
        let inner = Arc::new(FakeInner::default());
        let handler = AuditHandler {
            inner: inner.clone(),
        };
        let c = cfg(inner);
        let db = audit_db(1);
        let created = handler
            .create(&db, json!({"title": "x"}), &c)
            .await
            .unwrap();
        assert_eq!(created["title"], "x");
        assert!(format!("{:?}", db.into_transaction_log()).contains("audit_logs"));
    }

    #[tokio::test]
    async fn update_returns_before_after_and_attempts_audit() {
        let inner = Arc::new(FakeInner::default());
        let handler = AuditHandler {
            inner: inner.clone(),
        };
        let c = cfg(inner.clone());
        let db = audit_db(2);
        let created = handler
            .create(&db, json!({"title": "old"}), &c)
            .await
            .unwrap();
        let id = created["id"].as_str().unwrap().to_string();
        let (before, after) = handler
            .update(&db, &id, json!({"title": "new"}), &c)
            .await
            .unwrap();
        assert_eq!(before["title"], "old");
        assert_eq!(after["title"], "new");
    }

    #[tokio::test]
    async fn soft_delete_audits_only_when_a_row_was_removed() {
        let inner = Arc::new(FakeInner::default());
        let handler = AuditHandler {
            inner: inner.clone(),
        };
        let c = cfg(inner.clone());
        let db = audit_db(2);
        let created = handler
            .create(&db, json!({"title": "doomed"}), &c)
            .await
            .unwrap();
        let id = created["id"].as_str().unwrap().to_string();
        let n = handler.soft_delete(&db, &id, &c).await.unwrap();
        assert_eq!(n, 1);
        let zero = handler.soft_delete(&db, "absent", &c).await.unwrap();
        assert_eq!(zero, 0);
    }

    #[tokio::test]
    async fn hard_delete_audits_pre_image() {
        let inner = Arc::new(FakeInner::default());
        let handler = AuditHandler {
            inner: inner.clone(),
        };
        let c = cfg(inner.clone());
        let db = audit_db(2);
        let created = handler
            .create(&db, json!({"title": "gone"}), &c)
            .await
            .unwrap();
        let id = created["id"].as_str().unwrap().to_string();
        let n = handler.hard_delete(&db, &id, &c).await.unwrap();
        assert_eq!(n, 1);
    }

    #[tokio::test]
    async fn bulk_create_audits_each_returned_record() {
        let inner = Arc::new(FakeInner::default());
        let handler = AuditHandler {
            inner: inner.clone(),
        };
        let c = cfg(inner.clone());
        let db = audit_db(2);
        let out = handler
            .bulk_create(&db, vec![json!({"title": "a"}), json!({"title": "b"})], &c)
            .await
            .unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(
            format!("{:?}", db.into_transaction_log())
                .matches("audit_logs")
                .count(),
            2
        );
    }

    #[tokio::test]
    async fn bulk_delete_prefetches_and_audits_each() {
        let inner = Arc::new(FakeInner::default());
        let handler = AuditHandler {
            inner: inner.clone(),
        };
        let c = cfg(inner.clone());
        let db = audit_db(4);
        let mut ids = Vec::new();
        for t in ["a", "b"] {
            let created = handler
                .create(&db, json!({ "title": t }), &c)
                .await
                .unwrap();
            ids.push(created["id"].as_str().unwrap().to_string());
        }
        let n = handler.bulk_delete(&db, &ids, &c).await.unwrap();
        assert_eq!(n, 2);
    }

    #[tokio::test]
    async fn bulk_delete_no_rows_writes_nothing() {
        let inner = Arc::new(FakeInner::default());
        let handler = AuditHandler {
            inner: inner.clone(),
        };
        let c = cfg(inner);
        let db = audit_db(0);
        let n = handler
            .bulk_delete(&db, &["absent".to_string()], &c)
            .await
            .unwrap();
        assert_eq!(n, 0);
    }
}
