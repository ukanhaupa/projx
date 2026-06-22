use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use sea_orm::Set;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub const TABLE_NAME: &str = "audit_logs";

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "audit_logs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Uuid")]
    pub id: Uuid,
    pub table_name: String,
    pub record_id: String,
    pub action: String,
    #[sea_orm(column_type = "JsonBinary", nullable)]
    pub old_value: Option<Value>,
    #[sea_orm(column_type = "JsonBinary", nullable)]
    pub new_value: Option<Value>,
    #[sea_orm(default_value = "system")]
    pub performed_by: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

pub fn new_entry(
    table_name: &str,
    record_id: String,
    action: &str,
    old_value: Option<Value>,
    new_value: Option<Value>,
    performed_by: String,
) -> ActiveModel {
    ActiveModel {
        id: Set(Uuid::new_v4()),
        table_name: Set(table_name.to_string()),
        record_id: Set(record_id),
        action: Set(action.to_string()),
        old_value: Set(old_value),
        new_value: Set(new_value),
        performed_by: Set(performed_by),
        created_at: Set(Utc::now()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::ActiveValue;
    use serde_json::json;

    #[test]
    fn new_entry_populates_fields() {
        let am = new_entry(
            "posts",
            "rec-1".into(),
            "INSERT",
            None,
            Some(json!({"a": 1})),
            "system".into(),
        );
        assert!(matches!(am.table_name, ActiveValue::Set(v) if v == "posts"));
        assert!(matches!(am.record_id, ActiveValue::Set(v) if v == "rec-1"));
        assert!(matches!(am.action, ActiveValue::Set(v) if v == "INSERT"));
        assert!(matches!(am.old_value, ActiveValue::Set(None)));
        assert!(matches!(am.new_value, ActiveValue::Set(Some(_))));
        assert!(matches!(am.performed_by, ActiveValue::Set(v) if v == "system"));
    }

    #[test]
    fn new_entry_assigns_distinct_ids() {
        let a = new_entry("t", "1".into(), "DELETE", Some(json!({})), None, "x".into());
        let b = new_entry("t", "1".into(), "DELETE", Some(json!({})), None, "x".into());
        let ida = match a.id {
            ActiveValue::Set(v) => v,
            _ => unreachable!(),
        };
        let idb = match b.id {
            ActiveValue::Set(v) => v,
            _ => unreachable!(),
        };
        assert_ne!(ida, idb);
    }
}
