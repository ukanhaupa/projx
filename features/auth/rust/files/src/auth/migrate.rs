use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};

use crate::error::AppError;

const SCHEMA_SQL: &str = include_str!("schema.sql");

pub async fn run(db: &DatabaseConnection) -> Result<(), AppError> {
    for stmt in split_statements(SCHEMA_SQL) {
        db.execute(Statement::from_string(DatabaseBackend::Postgres, stmt))
            .await
            .map_err(|e| crate::apperr::from_db(e, "auth_migration"))?;
    }
    Ok(())
}

fn split_statements(sql: &str) -> Vec<String> {
    sql.split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

    #[test]
    fn schema_sql_is_present_and_creates_tables() {
        assert!(SCHEMA_SQL.contains("users"));
        assert!(SCHEMA_SQL.contains("refresh_tokens"));
        assert!(SCHEMA_SQL.contains("verification_tokens"));
        assert!(SCHEMA_SQL.contains("IF NOT EXISTS"));
    }

    #[test]
    fn split_statements_drops_blanks_and_trims() {
        let out = split_statements("  CREATE A; \n\n CREATE B ;;");
        assert_eq!(out, vec!["CREATE A".to_string(), "CREATE B".to_string()]);
    }

    #[test]
    fn split_statements_counts_schema_statements() {
        assert!(split_statements(SCHEMA_SQL).len() >= 3);
    }

    #[tokio::test]
    async fn run_executes_every_statement() {
        let count = split_statements(SCHEMA_SQL).len();
        let mut db = MockDatabase::new(DatabaseBackend::Postgres);
        for _ in 0..count {
            db = db.append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 0,
            }]);
        }
        let conn = db.into_connection();
        assert!(run(&conn).await.is_ok());
    }
}
