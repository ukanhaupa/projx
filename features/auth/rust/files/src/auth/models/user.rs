use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Uuid")]
    pub id: Uuid,
    #[sea_orm(unique)]
    pub email: String,
    pub name: String,
    #[serde(skip)]
    pub password_hash: String,
    pub role: String,
    pub email_verified: bool,
    pub email_verified_at: Option<DateTime<Utc>>,
    pub failed_login_count: i32,
    pub locked_until: Option<DateTime<Utc>>,
    pub mfa_enabled: bool,
    #[serde(skip)]
    pub mfa_secret_enc: Option<String>,
    #[serde(skip)]
    pub mfa_recovery_codes_enc: Option<String>,
    pub mfa_verified_at: Option<DateTime<Utc>>,
    pub mfa_failed_count: i32,
    pub mfa_locked_until: Option<DateTime<Utc>>,
    pub last_login: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

impl Model {
    pub fn active(email: String, name: String, password_hash: String, role: String) -> ActiveModel {
        let now = Utc::now();
        ActiveModel {
            id: sea_orm::Set(Uuid::new_v4()),
            email: sea_orm::Set(email),
            name: sea_orm::Set(name),
            password_hash: sea_orm::Set(password_hash),
            role: sea_orm::Set(role),
            email_verified: sea_orm::Set(false),
            email_verified_at: sea_orm::Set(None),
            failed_login_count: sea_orm::Set(0),
            locked_until: sea_orm::Set(None),
            mfa_enabled: sea_orm::Set(false),
            mfa_secret_enc: sea_orm::Set(None),
            mfa_recovery_codes_enc: sea_orm::Set(None),
            mfa_verified_at: sea_orm::Set(None),
            mfa_failed_count: sea_orm::Set(0),
            mfa_locked_until: sea_orm::Set(None),
            last_login: sea_orm::Set(None),
            created_at: sea_orm::Set(now),
            updated_at: sea_orm::Set(now),
            deleted_at: sea_orm::Set(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::ActiveValue;

    #[test]
    fn new_sets_defaults() {
        let am = Model::active(
            "a@b.com".into(),
            "Ann".into(),
            "hash".into(),
            "admin".into(),
        );
        assert!(matches!(am.email, ActiveValue::Set(ref e) if e == "a@b.com"));
        assert!(matches!(am.role, ActiveValue::Set(ref r) if r == "admin"));
        assert!(matches!(am.failed_login_count, ActiveValue::Set(0)));
        assert!(matches!(am.mfa_enabled, ActiveValue::Set(false)));
        assert!(matches!(am.email_verified, ActiveValue::Set(false)));
    }

    #[test]
    fn password_hash_is_skipped_in_serialization() {
        let now = Utc::now();
        let m = Model {
            id: Uuid::new_v4(),
            email: "a@b.com".into(),
            name: "Ann".into(),
            password_hash: "secret-hash".into(),
            role: "user".into(),
            email_verified: false,
            email_verified_at: None,
            failed_login_count: 0,
            locked_until: None,
            mfa_enabled: false,
            mfa_secret_enc: Some("enc".into()),
            mfa_recovery_codes_enc: None,
            mfa_verified_at: None,
            mfa_failed_count: 0,
            mfa_locked_until: None,
            last_login: None,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        };
        let json = serde_json::to_string(&m).unwrap();
        assert!(!json.contains("secret-hash"));
        assert!(!json.contains("enc"));
        assert!(json.contains("a@b.com"));
    }
}
