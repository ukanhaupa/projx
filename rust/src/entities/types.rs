use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use async_trait::async_trait;
use axum::http::HeaderMap;
use sea_orm::DatabaseConnection;
use serde_json::Value;

use crate::error::AppError;

use crate::entities::query::{ListParams, PageResult};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub type BeforeCreateHook = Arc<
    dyn for<'a> Fn(&'a HeaderMap, &'a mut Value) -> BoxFuture<'a, Result<(), AppError>>
        + Send
        + Sync,
>;

pub type AfterCreateHook = Arc<
    dyn for<'a> Fn(&'a HeaderMap, &'a Value) -> BoxFuture<'a, Result<(), AppError>> + Send + Sync,
>;

pub type BeforeUpdateHook = Arc<
    dyn for<'a> Fn(&'a HeaderMap, &'a mut Value) -> BoxFuture<'a, Result<bool, AppError>>
        + Send
        + Sync,
>;

pub type AfterUpdateHook = Arc<
    dyn for<'a> Fn(&'a HeaderMap, &'a Value, &'a Value) -> BoxFuture<'a, Result<(), AppError>>
        + Send
        + Sync,
>;

pub type BeforeDeleteHook = Arc<
    dyn for<'a> Fn(&'a HeaderMap, &'a str) -> BoxFuture<'a, Result<(), AppError>> + Send + Sync,
>;

#[derive(Clone, Default)]
pub struct Hooks {
    pub before_create: Option<BeforeCreateHook>,
    pub after_create: Option<AfterCreateHook>,
    pub before_update: Option<BeforeUpdateHook>,
    pub after_update: Option<AfterUpdateHook>,
    pub before_delete: Option<BeforeDeleteHook>,
    pub before_create_fields: Vec<&'static str>,
}

#[async_trait]
pub trait EntityHandler: Send + Sync {
    fn all_columns(&self) -> &'static [&'static str];
    fn updatable_columns(&self) -> &'static [&'static str];
    fn primary_key(&self) -> &'static str {
        "id"
    }

    async fn list(
        &self,
        db: &DatabaseConnection,
        params: &ListParams,
        cfg: &EntityConfig,
    ) -> Result<PageResult, AppError>;

    async fn get_by_id(
        &self,
        db: &DatabaseConnection,
        id: &str,
        cfg: &EntityConfig,
    ) -> Result<Value, AppError>;

    async fn create(
        &self,
        db: &DatabaseConnection,
        payload: Value,
        cfg: &EntityConfig,
    ) -> Result<Value, AppError>;

    async fn update(
        &self,
        db: &DatabaseConnection,
        id: &str,
        patch: Value,
        cfg: &EntityConfig,
    ) -> Result<(Value, Value), AppError>;

    async fn soft_delete(
        &self,
        db: &DatabaseConnection,
        id: &str,
        cfg: &EntityConfig,
    ) -> Result<u64, AppError>;

    async fn hard_delete(
        &self,
        db: &DatabaseConnection,
        id: &str,
        cfg: &EntityConfig,
    ) -> Result<u64, AppError>;

    async fn bulk_create(
        &self,
        db: &DatabaseConnection,
        payloads: Vec<Value>,
        cfg: &EntityConfig,
    ) -> Result<Vec<Value>, AppError>;

    async fn bulk_delete(
        &self,
        db: &DatabaseConnection,
        ids: &[String],
        cfg: &EntityConfig,
    ) -> Result<u64, AppError>;
}

#[derive(Clone)]
pub struct EntityConfig {
    pub name: &'static str,
    pub base_path: &'static str,
    pub handler: Arc<dyn EntityHandler>,
    pub searchable_fields: Vec<&'static str>,
    pub hidden_fields: Vec<&'static str>,
    pub soft_delete: bool,
    pub hooks: Hooks,
}

impl EntityConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.is_empty() {
            return Err("name is required".into());
        }
        if !self.base_path.starts_with('/') {
            return Err("base_path must start with /".into());
        }
        let cols = self.handler.all_columns();
        for f in &self.hooks.before_create_fields {
            if !cols.contains(f) {
                return Err(format!("before_create_fields: {:?} is not a column", f));
            }
        }
        Ok(())
    }

    pub fn strip_hidden(&self, value: &mut Value) {
        if self.hidden_fields.is_empty() {
            return;
        }
        if let Some(obj) = value.as_object_mut() {
            for h in &self.hidden_fields {
                obj.remove(*h);
            }
        } else if let Some(arr) = value.as_array_mut() {
            for item in arr {
                self.strip_hidden(item);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use serde_json::json;

    struct Stub;
    #[async_trait]
    impl EntityHandler for Stub {
        fn all_columns(&self) -> &'static [&'static str] {
            &["id", "name"]
        }
        fn updatable_columns(&self) -> &'static [&'static str] {
            &["name"]
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
            _: &str,
            _: &EntityConfig,
        ) -> Result<Value, AppError> {
            unreachable!()
        }
        async fn create(
            &self,
            _: &DatabaseConnection,
            _: Value,
            _: &EntityConfig,
        ) -> Result<Value, AppError> {
            unreachable!()
        }
        async fn update(
            &self,
            _: &DatabaseConnection,
            _: &str,
            _: Value,
            _: &EntityConfig,
        ) -> Result<(Value, Value), AppError> {
            unreachable!()
        }
        async fn soft_delete(
            &self,
            _: &DatabaseConnection,
            _: &str,
            _: &EntityConfig,
        ) -> Result<u64, AppError> {
            unreachable!()
        }
        async fn hard_delete(
            &self,
            _: &DatabaseConnection,
            _: &str,
            _: &EntityConfig,
        ) -> Result<u64, AppError> {
            unreachable!()
        }
        async fn bulk_create(
            &self,
            _: &DatabaseConnection,
            _: Vec<Value>,
            _: &EntityConfig,
        ) -> Result<Vec<Value>, AppError> {
            unreachable!()
        }
        async fn bulk_delete(
            &self,
            _: &DatabaseConnection,
            _: &[String],
            _: &EntityConfig,
        ) -> Result<u64, AppError> {
            unreachable!()
        }
    }

    fn cfg() -> EntityConfig {
        EntityConfig {
            name: "x",
            base_path: "/x",
            handler: Arc::new(Stub),
            searchable_fields: vec![],
            hidden_fields: vec!["password"],
            soft_delete: false,
            hooks: Hooks::default(),
        }
    }

    #[test]
    fn strip_hidden_removes_keys_from_object() {
        let c = cfg();
        let mut v = json!({"id":"1","name":"a","password":"secret"});
        c.strip_hidden(&mut v);
        assert!(v.get("password").is_none());
        assert_eq!(v["name"], "a");
    }

    #[test]
    fn strip_hidden_recurses_into_array() {
        let c = cfg();
        let mut v = json!([{"id":"1","password":"x"},{"id":"2","password":"y"}]);
        c.strip_hidden(&mut v);
        assert!(v[0].get("password").is_none());
        assert!(v[1].get("password").is_none());
    }

    #[test]
    fn strip_hidden_noop_when_empty() {
        let mut c = cfg();
        c.hidden_fields = vec![];
        let mut v = json!({"password":"x"});
        c.strip_hidden(&mut v);
        assert_eq!(v["password"], "x");
    }

    #[test]
    fn validate_ok_for_well_formed_config() {
        assert!(cfg().validate().is_ok());
    }

    #[test]
    fn validate_rejects_empty_name() {
        let mut c = cfg();
        c.name = "";
        assert!(c.validate().is_err());
    }

    #[test]
    fn validate_rejects_path_without_slash() {
        let mut c = cfg();
        c.base_path = "x";
        assert!(c.validate().is_err());
    }

    #[test]
    fn validate_rejects_unknown_hook_field() {
        let mut c = cfg();
        c.hooks.before_create_fields = vec!["missing"];
        assert!(c.validate().is_err());
    }
}
