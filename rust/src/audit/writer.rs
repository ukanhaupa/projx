use once_cell::sync::Lazy;
use sea_orm::{ConnectionTrait, EntityTrait};
use serde_json::Value;
use std::collections::HashSet;
use tracing::warn;

use crate::audit::actor;
use crate::audit::model::{self, Entity as AuditLog};
use crate::middleware::request_id::RequestId;

pub const INSERT: &str = "INSERT";
pub const UPDATE: &str = "UPDATE";
pub const DELETE: &str = "DELETE";

static AUDIT_SKIP_TABLES: Lazy<HashSet<&'static str>> =
    Lazy::new(|| HashSet::from([model::TABLE_NAME]));

pub fn is_audited(table_name: &str) -> bool {
    !AUDIT_SKIP_TABLES.contains(table_name)
}

pub async fn write<C: ConnectionTrait>(
    conn: &C,
    table_name: &str,
    record_id: impl Into<String>,
    action: &str,
    old_value: Option<Value>,
    new_value: Option<Value>,
) {
    if !is_audited(table_name) {
        return;
    }
    let entry = model::new_entry(
        table_name,
        record_id.into(),
        action,
        old_value,
        new_value,
        actor::current(),
    );
    if let Err(e) = AuditLog::insert(entry).exec(conn).await {
        warn!(
            request_id = ?RequestId::current(),
            table = table_name,
            action,
            error = %e,
            "failed to write audit log"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};
    use serde_json::json;

    #[test]
    fn audit_table_itself_is_not_audited() {
        assert!(!is_audited(model::TABLE_NAME));
        assert!(is_audited("posts"));
        assert!(is_audited("users"));
    }

    #[tokio::test]
    async fn write_inserts_a_row_for_audited_table() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        write(
            &db,
            "posts",
            "rec-1",
            INSERT,
            None,
            Some(json!({"title": "x"})),
        )
        .await;
        let log = format!("{:?}", db.into_transaction_log());
        assert!(log.contains("audit_logs"));
        assert!(log.contains("INSERT"));
    }

    #[tokio::test]
    async fn write_skips_audit_table_without_touching_db() {
        let db = MockDatabase::new(DatabaseBackend::Postgres).into_connection();
        write(&db, model::TABLE_NAME, "x", INSERT, None, None).await;
        let log = db.into_transaction_log();
        assert!(log.is_empty());
    }

    #[tokio::test]
    async fn write_swallows_db_errors() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_errors([sea_orm::DbErr::Custom("boom".into())])
            .into_connection();
        write(&db, "posts", "rec-2", DELETE, Some(json!({"a": 1})), None).await;
    }
}
