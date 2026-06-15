use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const KIND_PASSWORD_RESET: &str = "password_reset";
pub const KIND_EMAIL_VERIFY: &str = "email_verify";

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "verification_tokens")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Uuid")]
    pub id: Uuid,
    pub user_id: Uuid,
    pub kind: String,
    #[sea_orm(unique)]
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub consumed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

impl Model {
    pub fn active(
        user_id: Uuid,
        kind: &str,
        token_hash: String,
        expires_at: DateTime<Utc>,
    ) -> ActiveModel {
        let now = Utc::now();
        ActiveModel {
            id: sea_orm::Set(Uuid::new_v4()),
            user_id: sea_orm::Set(user_id),
            kind: sea_orm::Set(kind.to_string()),
            token_hash: sea_orm::Set(token_hash),
            expires_at: sea_orm::Set(expires_at),
            consumed_at: sea_orm::Set(None),
            created_at: sea_orm::Set(now),
            updated_at: sea_orm::Set(now),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::ActiveValue;

    #[test]
    fn new_sets_kind_and_hash() {
        let uid = Uuid::new_v4();
        let am = Model::active(uid, KIND_EMAIL_VERIFY, "h".into(), Utc::now());
        assert!(matches!(am.kind, ActiveValue::Set(ref k) if k == KIND_EMAIL_VERIFY));
        assert!(matches!(am.consumed_at, ActiveValue::Set(None)));
    }
}
