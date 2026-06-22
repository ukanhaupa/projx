use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use axum::Router;
use sea_orm::{
    ConnectionTrait, Database, DatabaseBackend, DatabaseConnection, FromQueryResult, Statement,
};
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;

use projx::audit;
use projx::entities::mount_entity;

static DB_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

const POSTS_TABLE_SQL: &str = "
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
)";

#[derive(Debug, FromQueryResult)]
struct AuditRow {
    table_name: String,
    record_id: String,
    action: String,
    old_value: Option<Value>,
    new_value: Option<Value>,
    performed_by: String,
}

fn db_url() -> Option<String> {
    std::env::var("TEST_DATABASE_URL")
        .ok()
        .or_else(|| std::env::var("DATABASE_URL").ok())
        .filter(|s| !s.trim().is_empty())
}

async fn setup() -> Option<(
    Arc<DatabaseConnection>,
    Router,
    tokio::sync::MutexGuard<'static, ()>,
)> {
    let url = match db_url() {
        Some(u) => u,
        None => {
            eprintln!(
                "skipping audit integration tests: set TEST_DATABASE_URL or DATABASE_URL to run"
            );
            return None;
        }
    };
    let guard = DB_LOCK.lock().await;
    let db = Database::connect(&url).await.expect("connect test db");
    db.execute(Statement::from_string(
        DatabaseBackend::Postgres,
        POSTS_TABLE_SQL.to_string(),
    ))
    .await
    .expect("create posts table");
    audit::migrate(&db).await.expect("audit migration");
    for tbl in ["posts", "audit_logs"] {
        db.execute(Statement::from_string(
            DatabaseBackend::Postgres,
            format!("TRUNCATE TABLE {tbl}"),
        ))
        .await
        .expect("truncate");
    }
    let db = Arc::new(db);
    let app = mount_entity(Router::new(), db.clone(), Arc::new(projx::posts::config()))
        .layer(axum::middleware::from_fn(audit::capture_actor));
    Some((db, app, guard))
}

async fn audit_rows(db: &DatabaseConnection) -> Vec<AuditRow> {
    AuditRow::find_by_statement(Statement::from_string(
        DatabaseBackend::Postgres,
        "SELECT table_name, record_id, action, old_value, new_value, performed_by \
         FROM audit_logs ORDER BY created_at, record_id"
            .to_string(),
    ))
    .all(db)
    .await
    .expect("query audit rows")
}

async fn json_body(resp: axum::response::Response) -> Value {
    let bytes = to_bytes(resp.into_body(), 256 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

async fn post_json(app: &Router, method: &str, uri: &str, body: Value) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn single_create_writes_one_insert_row() {
    let Some((db, app, _guard)) = setup().await else {
        return;
    };
    let resp = post_json(&app, "POST", "/api/v1/posts", json!({"title": "hello"})).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let created = json_body(resp).await;
    let id = created["id"].as_str().unwrap().to_string();

    let rows = audit_rows(db.as_ref()).await;
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row.table_name, "post");
    assert_eq!(row.record_id, id);
    assert_eq!(row.action, "INSERT");
    assert!(row.old_value.is_none());
    assert_eq!(row.new_value.as_ref().unwrap()["title"], "hello");
    assert_eq!(row.performed_by, "system");
}

#[tokio::test]
async fn bulk_create_writes_one_insert_row_per_record() {
    let Some((db, app, _guard)) = setup().await else {
        return;
    };
    let batch = json!([{"title": "a"}, {"title": "b"}, {"title": "c"}]);
    let resp = post_json(&app, "POST", "/api/v1/posts/bulk", batch).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let created = json_body(resp).await;
    let ids: Vec<String> = created
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ids.len(), 3);

    let rows = audit_rows(db.as_ref()).await;
    assert_eq!(rows.len(), 3);
    assert!(rows.iter().all(|r| r.action == "INSERT"));
    assert!(rows.iter().all(|r| r.old_value.is_none()));
    assert!(rows.iter().all(|r| r.new_value.is_some()));
    let logged: std::collections::HashSet<&str> =
        rows.iter().map(|r| r.record_id.as_str()).collect();
    for id in &ids {
        assert!(logged.contains(id.as_str()), "missing audit row for {id}");
    }
}

#[tokio::test]
async fn single_update_writes_one_update_row_with_pre_and_post_image() {
    let Some((db, app, _guard)) = setup().await else {
        return;
    };
    let created =
        json_body(post_json(&app, "POST", "/api/v1/posts", json!({"title": "before"})).await).await;
    let id = created["id"].as_str().unwrap().to_string();

    let resp = post_json(
        &app,
        "PATCH",
        &format!("/api/v1/posts/{id}"),
        json!({"title": "after"}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    let rows = audit_rows(db.as_ref()).await;
    let update_rows: Vec<&AuditRow> = rows.iter().filter(|r| r.action == "UPDATE").collect();
    assert_eq!(update_rows.len(), 1);
    let row = update_rows[0];
    assert_eq!(row.record_id, id);
    assert_eq!(row.old_value.as_ref().unwrap()["title"], "before");
    assert_eq!(row.new_value.as_ref().unwrap()["title"], "after");
}

#[tokio::test]
async fn single_delete_writes_one_delete_row_with_pre_image_only() {
    let Some((db, app, _guard)) = setup().await else {
        return;
    };
    let created =
        json_body(post_json(&app, "POST", "/api/v1/posts", json!({"title": "doomed"})).await).await;
    let id = created["id"].as_str().unwrap().to_string();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/posts/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let rows = audit_rows(db.as_ref()).await;
    let delete_rows: Vec<&AuditRow> = rows.iter().filter(|r| r.action == "DELETE").collect();
    assert_eq!(delete_rows.len(), 1);
    let row = delete_rows[0];
    assert_eq!(row.record_id, id);
    assert_eq!(row.old_value.as_ref().unwrap()["title"], "doomed");
    assert!(row.new_value.is_none());
}

#[tokio::test]
async fn bulk_delete_writes_one_delete_row_per_affected_record() {
    let Some((db, app, _guard)) = setup().await else {
        return;
    };
    let batch = json!([{"title": "d1"}, {"title": "d2"}, {"title": "d3"}]);
    let created = json_body(post_json(&app, "POST", "/api/v1/posts/bulk", batch).await).await;
    let ids: Vec<String> = created
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap().to_string())
        .collect();

    let resp = post_json(
        &app,
        "DELETE",
        "/api/v1/posts/bulk",
        json!({ "ids": ids.clone() }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let rows = audit_rows(db.as_ref()).await;
    let delete_rows: Vec<&AuditRow> = rows.iter().filter(|r| r.action == "DELETE").collect();
    assert_eq!(delete_rows.len(), 3);
    assert!(delete_rows.iter().all(|r| r.new_value.is_none()));
    assert!(delete_rows.iter().all(|r| r.old_value.is_some()));
    let logged: std::collections::HashSet<&str> =
        delete_rows.iter().map(|r| r.record_id.as_str()).collect();
    for id in &ids {
        assert!(
            logged.contains(id.as_str()),
            "missing bulk-delete audit row for {id}"
        );
    }
}

#[tokio::test]
async fn audit_table_writes_never_recurse() {
    let Some((db, app, _guard)) = setup().await else {
        return;
    };
    for i in 0..3 {
        post_json(
            &app,
            "POST",
            "/api/v1/posts",
            json!({"title": format!("t{i}")}),
        )
        .await;
    }
    let rows = audit_rows(db.as_ref()).await;
    assert_eq!(rows.len(), 3);
    assert!(
        rows.iter().all(|r| r.table_name != "audit_logs"),
        "audit_logs must never audit itself"
    );
}
