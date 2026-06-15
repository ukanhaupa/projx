use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use sea_orm::{ColumnTrait, Condition, DatabaseConnection, EntityTrait, QueryFilter};
use tokio::time::interval;

use crate::apperr::from_db;
use crate::auth::models::{refresh_token, verification_token};
use crate::error::AppError;

const DEFAULT_INTERVAL_SECONDS: u64 = 24 * 60 * 60;
const REVOKED_RETENTION_DAYS: i64 = 30;

pub fn enabled() -> bool {
    !matches!(
        std::env::var("AUTH_BACKGROUND_JOBS"),
        Ok(v) if v.trim().eq_ignore_ascii_case("false")
    )
}

pub fn interval_seconds() -> u64 {
    match std::env::var("AUTH_CLEANUP_INTERVAL_SECONDS") {
        Ok(v) => v.trim().parse::<u64>().ok().filter(|n| *n > 0),
        Err(_) => None,
    }
    .unwrap_or(DEFAULT_INTERVAL_SECONDS)
}

pub fn spawn(db: Arc<DatabaseConnection>) {
    if !enabled() {
        return;
    }
    let secs = interval_seconds();
    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(secs));
        loop {
            ticker.tick().await;
            match cleanup(db.as_ref()).await {
                Ok((v, r)) if v > 0 || r > 0 => {
                    tracing::info!(
                        verification_tokens = v,
                        refresh_tokens = r,
                        "[cleanup] auth artifacts cleaned up"
                    );
                }
                Ok(_) => {}
                Err(e) => tracing::error!(error = %e, "[cleanup] auth artifacts cleanup failed"),
            }
        }
    });
}

pub async fn cleanup(db: &DatabaseConnection) -> Result<(u64, u64), AppError> {
    let now = Utc::now();
    let cutoff = now - chrono::Duration::days(REVOKED_RETENTION_DAYS);

    let v = verification_token::Entity::delete_many()
        .filter(
            Condition::any()
                .add(verification_token::Column::ExpiresAt.lt(now))
                .add(
                    Condition::all()
                        .add(verification_token::Column::ConsumedAt.is_not_null())
                        .add(verification_token::Column::ConsumedAt.lt(cutoff)),
                ),
        )
        .exec(db)
        .await
        .map_err(|e| from_db(e, "verification_token"))?;

    let r = refresh_token::Entity::delete_many()
        .filter(
            Condition::any()
                .add(refresh_token::Column::ExpiresAt.lt(now))
                .add(
                    Condition::all()
                        .add(refresh_token::Column::RevokedAt.is_not_null())
                        .add(refresh_token::Column::RevokedAt.lt(cutoff)),
                ),
        )
        .exec(db)
        .await
        .map_err(|e| from_db(e, "refresh_token"))?;

    Ok((v.rows_affected, r.rows_affected))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

    #[test]
    fn enabled_default_true_false_only_when_set() {
        let _guard = crate::auth::service::ENV_LOCK.lock().unwrap();
        std::env::remove_var("AUTH_BACKGROUND_JOBS");
        assert!(enabled());
        std::env::set_var("AUTH_BACKGROUND_JOBS", "false");
        assert!(!enabled());
        std::env::set_var("AUTH_BACKGROUND_JOBS", "true");
        assert!(enabled());
        std::env::remove_var("AUTH_BACKGROUND_JOBS");
    }

    #[test]
    fn interval_seconds_parses_or_defaults() {
        let _guard = crate::auth::service::ENV_LOCK.lock().unwrap();
        std::env::remove_var("AUTH_CLEANUP_INTERVAL_SECONDS");
        assert_eq!(interval_seconds(), DEFAULT_INTERVAL_SECONDS);
        std::env::set_var("AUTH_CLEANUP_INTERVAL_SECONDS", "90");
        assert_eq!(interval_seconds(), 90);
        std::env::set_var("AUTH_CLEANUP_INTERVAL_SECONDS", "0");
        assert_eq!(interval_seconds(), DEFAULT_INTERVAL_SECONDS);
        std::env::set_var("AUTH_CLEANUP_INTERVAL_SECONDS", "abc");
        assert_eq!(interval_seconds(), DEFAULT_INTERVAL_SECONDS);
        std::env::remove_var("AUTH_CLEANUP_INTERVAL_SECONDS");
    }

    #[tokio::test]
    async fn cleanup_returns_deleted_counts() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 2,
            }])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 3,
            }])
            .into_connection();
        let (v, r) = cleanup(&db).await.unwrap();
        assert_eq!(v, 2);
        assert_eq!(r, 3);
    }

    #[tokio::test]
    async fn spawn_noop_when_disabled() {
        let _guard = crate::auth::service::ENV_LOCK.lock().unwrap();
        std::env::set_var("AUTH_BACKGROUND_JOBS", "false");
        let db = Arc::new(MockDatabase::new(DatabaseBackend::Postgres).into_connection());
        spawn(db);
        std::env::remove_var("AUTH_BACKGROUND_JOBS");
    }
}
