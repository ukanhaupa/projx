use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use sea_orm::sea_query::{Alias, Condition, Expr, IntoCondition, Order};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::apperr::from_db;
use crate::entities::query::{ListParams, PageResult};
use crate::entities::types::{EntityConfig, EntityHandler, Hooks};
use crate::error::AppError;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "posts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Uuid")]
    pub id: Uuid,
    pub title: String,
    #[sea_orm(default_value = "")]
    pub body: String,
    #[sea_orm(default_value = false)]
    pub published: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

const ALL_COLUMNS: &[&str] = &[
    "id",
    "title",
    "body",
    "published",
    "created_at",
    "updated_at",
    "deleted_at",
];

const UPDATABLE_COLUMNS: &[&str] = &["title", "body", "published"];

const SEARCHABLE: &[&str] = &["title", "body"];

pub struct PostHandler;

fn model_to_value(m: &Model) -> Value {
    json!({
        "id": m.id.to_string(),
        "title": m.title,
        "body": m.body,
        "published": m.published,
        "created_at": m.created_at,
        "updated_at": m.updated_at,
        "deleted_at": m.deleted_at,
    })
}

fn parse_uuid(id: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(id).map_err(|_| AppError::Validation("invalid id".into()))
}

fn col_from_str(name: &str) -> Option<Column> {
    match name {
        "id" => Some(Column::Id),
        "title" => Some(Column::Title),
        "body" => Some(Column::Body),
        "published" => Some(Column::Published),
        "created_at" => Some(Column::CreatedAt),
        "updated_at" => Some(Column::UpdatedAt),
        "deleted_at" => Some(Column::DeletedAt),
        _ => None,
    }
}

#[async_trait]
impl EntityHandler for PostHandler {
    fn all_columns(&self) -> &'static [&'static str] {
        ALL_COLUMNS
    }
    fn updatable_columns(&self) -> &'static [&'static str] {
        UPDATABLE_COLUMNS
    }

    async fn list(
        &self,
        db: &DatabaseConnection,
        params: &ListParams,
        cfg: &EntityConfig,
    ) -> Result<PageResult, AppError> {
        let mut q = Entity::find();
        if cfg.soft_delete && !params.include_deleted {
            q = q.filter(Column::DeletedAt.is_null());
        }

        for (k, v) in &params.filters {
            if let Some(col) = col_from_str(k) {
                q = q.filter(col.eq(v.clone()));
            }
        }

        if let Some(needle) = &params.search {
            if !cfg.searchable_fields.is_empty() {
                let pattern = format!("%{}%", needle);
                let mut cond = Condition::any();
                for f in &cfg.searchable_fields {
                    if let Some(col) = col_from_str(f) {
                        cond = cond.add(
                            Expr::col(col)
                                .cast_as(Alias::new("text"))
                                .like(pattern.clone()),
                        );
                    }
                }
                q = q.filter(cond.into_condition());
            }
        }

        for raw in &params.order_by {
            let (desc, key) = if let Some(rest) = raw.strip_prefix('-') {
                (true, rest)
            } else {
                (false, raw.as_str())
            };
            if let Some(col) = col_from_str(key) {
                q = if desc {
                    q.order_by(col, Order::Desc)
                } else {
                    q.order_by(col, Order::Asc)
                };
            }
        }

        let total = q
            .clone()
            .count(db)
            .await
            .map_err(|e| from_db(e, cfg.name))?;
        let rows = q
            .limit(params.page_size)
            .offset(params.offset())
            .all(db)
            .await
            .map_err(|e| from_db(e, cfg.name))?;

        let data = Value::Array(rows.iter().map(model_to_value).collect());
        Ok(PageResult {
            data,
            pagination: params.pagination(total),
        })
    }

    async fn get_by_id(
        &self,
        db: &DatabaseConnection,
        id: &str,
        cfg: &EntityConfig,
    ) -> Result<Value, AppError> {
        let uid = parse_uuid(id)?;
        let mut q = Entity::find_by_id(uid);
        if cfg.soft_delete {
            q = q.filter(Column::DeletedAt.is_null());
        }
        let row = q
            .one(db)
            .await
            .map_err(|e| from_db(e, cfg.name))?
            .ok_or_else(|| AppError::NotFound(cfg.name.to_string()))?;
        Ok(model_to_value(&row))
    }

    async fn create(
        &self,
        db: &DatabaseConnection,
        payload: Value,
        cfg: &EntityConfig,
    ) -> Result<Value, AppError> {
        insert_one(db, payload, cfg.name).await
    }

    async fn update(
        &self,
        db: &DatabaseConnection,
        id: &str,
        patch: Value,
        cfg: &EntityConfig,
    ) -> Result<(Value, Value), AppError> {
        let uid = parse_uuid(id)?;
        let mut q = Entity::find_by_id(uid);
        if cfg.soft_delete {
            q = q.filter(Column::DeletedAt.is_null());
        }
        let existing = q
            .one(db)
            .await
            .map_err(|e| from_db(e, cfg.name))?
            .ok_or_else(|| AppError::NotFound(cfg.name.to_string()))?;
        let before = model_to_value(&existing);

        let mut am: ActiveModel = existing.into();
        if let Some(v) = patch.get("title") {
            if let Some(s) = v.as_str() {
                if s.is_empty() {
                    return Err(AppError::Validation("field 'title' is required".into()));
                }
                if s.len() > 200 {
                    return Err(AppError::Validation(
                        "field 'title' must be at most 200 chars".into(),
                    ));
                }
                am.title = Set(s.to_string());
            }
        }
        if let Some(v) = patch.get("body") {
            if let Some(s) = v.as_str() {
                am.body = Set(s.to_string());
            }
        }
        if let Some(v) = patch.get("published") {
            if let Some(b) = v.as_bool() {
                am.published = Set(b);
            }
        }
        am.updated_at = Set(Utc::now());
        let updated = am.update(db).await.map_err(|e| from_db(e, cfg.name))?;
        Ok((before, model_to_value(&updated)))
    }

    async fn soft_delete(
        &self,
        db: &DatabaseConnection,
        id: &str,
        cfg: &EntityConfig,
    ) -> Result<u64, AppError> {
        let uid = parse_uuid(id)?;
        let existing = Entity::find_by_id(uid)
            .filter(Column::DeletedAt.is_null())
            .one(db)
            .await
            .map_err(|e| from_db(e, cfg.name))?;
        let Some(model) = existing else {
            return Ok(0);
        };
        let mut am: ActiveModel = model.into();
        am.deleted_at = Set(Some(Utc::now()));
        am.updated_at = Set(Utc::now());
        am.update(db).await.map_err(|e| from_db(e, cfg.name))?;
        Ok(1)
    }

    async fn hard_delete(
        &self,
        db: &DatabaseConnection,
        id: &str,
        cfg: &EntityConfig,
    ) -> Result<u64, AppError> {
        let uid = parse_uuid(id)?;
        let res = Entity::delete_by_id(uid)
            .exec(db)
            .await
            .map_err(|e| from_db(e, cfg.name))?;
        Ok(res.rows_affected)
    }

    async fn bulk_create(
        &self,
        db: &DatabaseConnection,
        payloads: Vec<Value>,
        cfg: &EntityConfig,
    ) -> Result<Vec<Value>, AppError> {
        let txn = db.begin().await.map_err(|e| from_db(e, cfg.name))?;
        let mut out = Vec::with_capacity(payloads.len());
        for payload in payloads {
            match insert_one(&txn, payload, cfg.name).await {
                Ok(v) => out.push(v),
                Err(e) => {
                    let _ = txn.rollback().await;
                    return Err(e);
                }
            }
        }
        txn.commit().await.map_err(|e| from_db(e, cfg.name))?;
        Ok(out)
    }

    async fn bulk_delete(
        &self,
        db: &DatabaseConnection,
        ids: &[String],
        cfg: &EntityConfig,
    ) -> Result<u64, AppError> {
        let mut uuids = Vec::with_capacity(ids.len());
        for id in ids {
            uuids.push(parse_uuid(id)?);
        }
        if cfg.soft_delete {
            let now = Utc::now();
            let res = Entity::update_many()
                .col_expr(Column::DeletedAt, Expr::value(Some(now)))
                .col_expr(Column::UpdatedAt, Expr::value(now))
                .filter(Column::Id.is_in(uuids))
                .filter(Column::DeletedAt.is_null())
                .exec(db)
                .await
                .map_err(|e| from_db(e, cfg.name))?;
            Ok(res.rows_affected)
        } else {
            let res = Entity::delete_many()
                .filter(Column::Id.is_in(uuids))
                .exec(db)
                .await
                .map_err(|e| from_db(e, cfg.name))?;
            Ok(res.rows_affected)
        }
    }
}

async fn insert_one<C: sea_orm::ConnectionTrait>(
    conn: &C,
    payload: Value,
    name: &str,
) -> Result<Value, AppError> {
    let title = payload
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Validation("field 'title' is required".into()))?
        .to_string();
    if title.is_empty() {
        return Err(AppError::Validation("field 'title' is required".into()));
    }
    if title.len() > 200 {
        return Err(AppError::Validation(
            "field 'title' must be at most 200 chars".into(),
        ));
    }
    let body = payload
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let published = payload
        .get("published")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let now = Utc::now();
    let am = ActiveModel {
        id: Set(Uuid::new_v4()),
        title: Set(title),
        body: Set(body),
        published: Set(published),
        created_at: Set(now),
        updated_at: Set(now),
        deleted_at: Set(None),
    };
    let inserted = am.insert(conn).await.map_err(|e| from_db(e, name))?;
    Ok(model_to_value(&inserted))
}

pub fn config() -> EntityConfig {
    EntityConfig {
        name: "post",
        base_path: "/posts",
        handler: Arc::new(PostHandler),
        searchable_fields: SEARCHABLE.to_vec(),
        hidden_fields: vec!["deleted_at"],
        soft_delete: true,
        hooks: Hooks::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

    fn mock_db() -> DatabaseConnection {
        MockDatabase::new(DatabaseBackend::Postgres).into_connection()
    }

    #[test]
    fn config_is_well_formed() {
        let c = config();
        assert_eq!(c.name, "post");
        assert_eq!(c.base_path, "/posts");
        assert!(c.soft_delete);
        assert_eq!(c.searchable_fields, vec!["title", "body"]);
        assert!(c.validate().is_ok());
    }

    #[test]
    fn parse_uuid_rejects_garbage() {
        assert!(parse_uuid("not-a-uuid").is_err());
        assert!(parse_uuid(&Uuid::new_v4().to_string()).is_ok());
    }

    #[test]
    fn col_from_str_known_and_unknown() {
        assert!(col_from_str("title").is_some());
        assert!(col_from_str("body").is_some());
        assert!(col_from_str("doesnotexist").is_none());
    }

    #[test]
    fn model_to_value_serializes_fields() {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let m = Model {
            id,
            title: "t".into(),
            body: "b".into(),
            published: true,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        };
        let v = model_to_value(&m);
        assert_eq!(v["id"], id.to_string());
        assert_eq!(v["title"], "t");
        assert_eq!(v["published"], true);
    }

    #[tokio::test]
    async fn insert_one_rejects_empty_title() {
        let db = mock_db();
        let err = insert_one(&db, json!({"title": ""}), "post")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn insert_one_rejects_long_title() {
        let db = mock_db();
        let long = "x".repeat(201);
        let err = insert_one(&db, json!({"title": long}), "post")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn insert_one_requires_title_field() {
        let db = mock_db();
        let err = insert_one(&db, json!({"body": "x"}), "post")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn handler_create_writes_row() {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let inserted = Model {
            id,
            title: "hello".into(),
            body: "".into(),
            published: false,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        };
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![inserted]])
            .into_connection();
        let cfg = config();
        let v = PostHandler
            .create(&db, json!({"title":"hello"}), &cfg)
            .await
            .unwrap();
        assert_eq!(v["title"], "hello");
    }

    #[tokio::test]
    async fn handler_hard_delete_returns_rows_affected() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        let cfg = config();
        let id = Uuid::new_v4().to_string();
        let n = PostHandler.hard_delete(&db, &id, &cfg).await.unwrap();
        assert_eq!(n, 1);
    }

    #[tokio::test]
    async fn handler_get_by_id_404_when_missing() {
        let empty: Vec<Model> = vec![];
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([empty])
            .into_connection();
        let cfg = config();
        let err = PostHandler
            .get_by_id(&db, &Uuid::new_v4().to_string(), &cfg)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    fn sample(title: &str) -> Model {
        let now = Utc::now();
        Model {
            id: Uuid::new_v4(),
            title: title.into(),
            body: String::new(),
            published: false,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        }
    }

    fn count_row(n: i64) -> std::collections::BTreeMap<String, sea_orm::Value> {
        let mut m = std::collections::BTreeMap::new();
        m.insert("num_items".to_string(), sea_orm::Value::BigInt(Some(n)));
        m
    }

    #[tokio::test]
    async fn handler_get_by_id_returns_model() {
        let m = sample("found");
        let id = m.id;
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![m]])
            .into_connection();
        let cfg = config();
        let v = PostHandler
            .get_by_id(&db, &id.to_string(), &cfg)
            .await
            .unwrap();
        assert_eq!(v["title"], "found");
        assert_eq!(v["id"], id.to_string());
    }

    #[tokio::test]
    async fn handler_get_by_id_rejects_bad_uuid() {
        let db = mock_db();
        let cfg = config();
        let err = PostHandler
            .get_by_id(&db, "not-a-uuid", &cfg)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn handler_list_returns_data_and_pagination() {
        let rows = vec![sample("a"), sample("b")];
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![count_row(2)]])
            .append_query_results([rows])
            .into_connection();
        let cfg = config();
        let params = ListParams {
            page: 1,
            page_size: 25,
            ..Default::default()
        };
        let res = PostHandler.list(&db, &params, &cfg).await.unwrap();
        assert_eq!(res.pagination.total_records, 2);
        assert_eq!(res.data.as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn handler_list_applies_search_filter_order() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![count_row(1)]])
            .append_query_results([vec![sample("hello world")]])
            .into_connection();
        let cfg = config();
        let mut filters = std::collections::HashMap::new();
        filters.insert("published".to_string(), "true".to_string());
        let params = ListParams {
            page: 1,
            page_size: 25,
            order_by: vec!["-created_at".into(), "title".into()],
            search: Some("hello".into()),
            include_deleted: false,
            filters,
        };
        let res = PostHandler.list(&db, &params, &cfg).await.unwrap();
        assert_eq!(res.pagination.total_records, 1);
        let stmts = db.into_transaction_log();
        let sql = format!("{:?}", stmts);
        assert!(sql.contains("LIKE"));
        assert!(sql.contains("ORDER BY"));
        assert!(sql.contains("deleted_at"));
    }

    #[tokio::test]
    async fn handler_list_include_deleted_skips_soft_delete_filter() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![count_row(0)]])
            .append_query_results([Vec::<Model>::new()])
            .into_connection();
        let cfg = config();
        let params = ListParams {
            page: 1,
            page_size: 25,
            include_deleted: true,
            ..Default::default()
        };
        let res = PostHandler.list(&db, &params, &cfg).await.unwrap();
        assert_eq!(res.pagination.total_records, 0);
    }

    #[tokio::test]
    async fn handler_update_applies_patch() {
        let existing = sample("old");
        let id = existing.id;
        let mut updated = existing.clone();
        updated.title = "new".into();
        updated.published = true;
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![existing]])
            .append_query_results([vec![updated]])
            .into_connection();
        let cfg = config();
        let (before, after) = PostHandler
            .update(
                &db,
                &id.to_string(),
                json!({"title": "new", "published": true, "body": "x"}),
                &cfg,
            )
            .await
            .unwrap();
        assert_eq!(before["title"], "old");
        assert_eq!(after["title"], "new");
        assert_eq!(after["published"], true);
    }

    #[tokio::test]
    async fn handler_update_rejects_empty_title() {
        let existing = sample("old");
        let id = existing.id;
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![existing]])
            .into_connection();
        let cfg = config();
        let err = PostHandler
            .update(&db, &id.to_string(), json!({"title": ""}), &cfg)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn handler_update_rejects_overlong_title() {
        let existing = sample("old");
        let id = existing.id;
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![existing]])
            .into_connection();
        let cfg = config();
        let err = PostHandler
            .update(
                &db,
                &id.to_string(),
                json!({"title": "x".repeat(201)}),
                &cfg,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn handler_update_404_when_missing() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<Model>::new()])
            .into_connection();
        let cfg = config();
        let err = PostHandler
            .update(
                &db,
                &Uuid::new_v4().to_string(),
                json!({"title": "x"}),
                &cfg,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[tokio::test]
    async fn handler_soft_delete_marks_row() {
        let existing = sample("doomed");
        let id = existing.id;
        let mut deleted = existing.clone();
        deleted.deleted_at = Some(Utc::now());
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![existing]])
            .append_query_results([vec![deleted]])
            .into_connection();
        let cfg = config();
        let n = PostHandler
            .soft_delete(&db, &id.to_string(), &cfg)
            .await
            .unwrap();
        assert_eq!(n, 1);
    }

    #[tokio::test]
    async fn handler_soft_delete_returns_zero_when_missing() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<Model>::new()])
            .into_connection();
        let cfg = config();
        let n = PostHandler
            .soft_delete(&db, &Uuid::new_v4().to_string(), &cfg)
            .await
            .unwrap();
        assert_eq!(n, 0);
    }

    #[tokio::test]
    async fn handler_bulk_create_inserts_all() {
        let a = sample("a");
        let b = sample("b");
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![a]])
            .append_query_results([vec![b]])
            .into_connection();
        let cfg = config();
        let out = PostHandler
            .bulk_create(
                &db,
                vec![json!({"title": "a"}), json!({"title": "b"})],
                &cfg,
            )
            .await
            .unwrap();
        assert_eq!(out.len(), 2);
    }

    #[tokio::test]
    async fn handler_bulk_create_rolls_back_on_invalid() {
        let db = MockDatabase::new(DatabaseBackend::Postgres).into_connection();
        let cfg = config();
        let err = PostHandler
            .bulk_create(&db, vec![json!({"body": "no title"})], &cfg)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn handler_bulk_delete_soft_updates_many() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 3,
            }])
            .into_connection();
        let cfg = config();
        let ids: Vec<String> = (0..3).map(|_| Uuid::new_v4().to_string()).collect();
        let n = PostHandler.bulk_delete(&db, &ids, &cfg).await.unwrap();
        assert_eq!(n, 3);
        let sql = format!("{:?}", db.into_transaction_log());
        assert!(sql.contains("UPDATE"));
        assert!(sql.contains("deleted_at"));
    }

    #[tokio::test]
    async fn handler_bulk_delete_hard_when_not_soft() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 2,
            }])
            .into_connection();
        let mut cfg = config();
        cfg.soft_delete = false;
        let ids: Vec<String> = (0..2).map(|_| Uuid::new_v4().to_string()).collect();
        let n = PostHandler.bulk_delete(&db, &ids, &cfg).await.unwrap();
        assert_eq!(n, 2);
        let sql = format!("{:?}", db.into_transaction_log());
        assert!(sql.contains("DELETE"));
    }

    #[tokio::test]
    async fn handler_bulk_delete_rejects_bad_uuid() {
        let db = mock_db();
        let cfg = config();
        let err = PostHandler
            .bulk_delete(&db, &["nope".to_string()], &cfg)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn handler_create_maps_db_conflict() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_errors([sea_orm::DbErr::Custom(
                "duplicate key value violates unique constraint code: \"23505\"".into(),
            )])
            .into_connection();
        let cfg = config();
        let err = PostHandler
            .create(&db, json!({"title": "dup"}), &cfg)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }
}
