use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "refresh_tokens")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Uuid")]
    pub id: Uuid,
    pub user_id: Uuid,
    pub session_id: Uuid,
    #[sea_orm(unique)]
    pub token_hash: String,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub expires_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub rotated_to: Option<Uuid>,
    pub replay_detected_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

impl Model {
    pub fn active(
        user_id: Uuid,
        session_id: Uuid,
        token_hash: String,
        ip_address: Option<String>,
        user_agent: Option<String>,
        expires_at: DateTime<Utc>,
    ) -> ActiveModel {
        let now = Utc::now();
        ActiveModel {
            id: sea_orm::Set(Uuid::new_v4()),
            user_id: sea_orm::Set(user_id),
            session_id: sea_orm::Set(session_id),
            token_hash: sea_orm::Set(token_hash),
            ip_address: sea_orm::Set(ip_address),
            user_agent: sea_orm::Set(user_agent),
            expires_at: sea_orm::Set(expires_at),
            revoked_at: sea_orm::Set(None),
            rotated_to: sea_orm::Set(None),
            replay_detected_at: sea_orm::Set(None),
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
    fn new_populates_required_fields() {
        let uid = Uuid::new_v4();
        let sid = Uuid::new_v4();
        let exp = Utc::now();
        let am = Model::active(uid, sid, "hash".into(), Some("1.2.3.4".into()), None, exp);
        assert!(matches!(am.user_id, ActiveValue::Set(v) if v == uid));
        assert!(matches!(am.session_id, ActiveValue::Set(v) if v == sid));
        assert!(matches!(am.revoked_at, ActiveValue::Set(None)));
        assert!(matches!(am.rotated_to, ActiveValue::Set(None)));
    }
}
