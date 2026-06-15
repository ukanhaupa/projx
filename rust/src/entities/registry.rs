use std::sync::{Arc, RwLock};

use once_cell::sync::Lazy;

use crate::entities::types::EntityConfig;

static REGISTRY: Lazy<RwLock<Vec<Arc<EntityConfig>>>> = Lazy::new(|| RwLock::new(Vec::new()));

pub fn register(cfg: EntityConfig) {
    if let Err(e) = cfg.validate() {
        panic!("entities::register({}): {}", cfg.name, e);
    }
    let mut guard = REGISTRY.write().expect("registry write lock poisoned");
    guard.push(Arc::new(cfg));
}

pub fn all() -> Vec<Arc<EntityConfig>> {
    let guard = REGISTRY.read().expect("registry read lock poisoned");
    guard.clone()
}

pub fn reset() {
    let mut guard = REGISTRY.write().expect("registry write lock poisoned");
    guard.clear();
}

#[cfg(test)]
pub(crate) static TEST_REGISTRY_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[cfg(test)]
mod tests {
    use super::TEST_REGISTRY_LOCK as TEST_LOCK;
    use super::*;
    use crate::entities::query::{ListParams, PageResult};
    use crate::entities::types::{EntityHandler, Hooks};
    use crate::error::AppError;
    use async_trait::async_trait;
    use sea_orm::DatabaseConnection;
    use serde_json::Value;

    struct StubHandler;

    #[async_trait]
    impl EntityHandler for StubHandler {
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

    fn cfg(name: &'static str, path: &'static str) -> EntityConfig {
        EntityConfig {
            name,
            base_path: path,
            handler: Arc::new(StubHandler),
            searchable_fields: vec!["name"],
            hidden_fields: vec![],
            soft_delete: false,
            hooks: Hooks::default(),
        }
    }

    #[tokio::test]
    async fn register_appends_and_all_clones() {
        let _g = TEST_LOCK.lock().await;
        reset();
        register(cfg("a", "/a"));
        register(cfg("b", "/b"));
        let entries = all();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "a");
        assert_eq!(entries[1].name, "b");
        reset();
    }

    #[tokio::test]
    #[should_panic(expected = "name is required")]
    async fn register_panics_on_empty_name() {
        let _g = TEST_LOCK.lock().await;
        reset();
        register(cfg("", "/x"));
    }

    #[tokio::test]
    #[should_panic(expected = "base_path must start with /")]
    async fn register_panics_on_bad_path() {
        let _g = TEST_LOCK.lock().await;
        reset();
        register(cfg("x", "bad"));
    }

    #[tokio::test]
    #[should_panic(expected = "is not a column")]
    async fn register_panics_on_unknown_hook_field() {
        let _g = TEST_LOCK.lock().await;
        reset();
        let mut c = cfg("x", "/x");
        c.hooks.before_create_fields = vec!["nonexistent"];
        register(c);
    }
}
