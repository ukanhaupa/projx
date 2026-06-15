pub use crate::error::{AppError, AppResult, ErrorEnvelope};

#[tracing::instrument(skip(err))]
pub fn from_db(err: sea_orm::DbErr, resource: &str) -> AppError {
    if let sea_orm::DbErr::RecordNotFound(_) = &err {
        return AppError::NotFound(resource.to_string());
    }
    if let Some(code) = pg_sqlstate(&err) {
        match code.as_str() {
            "23505" => return AppError::Conflict(format!("{resource} already exists")),
            "23503" => return AppError::Conflict(format!("{resource} foreign key violation")),
            _ => {}
        }
    }
    AppError::Internal(anyhow::Error::from(err))
}

fn pg_sqlstate(err: &sea_orm::DbErr) -> Option<String> {
    let msg = err.to_string();
    if let Some(idx) = msg.find("SQLSTATE ") {
        let tail = &msg[idx + "SQLSTATE ".len()..];
        let code: String = tail.chars().take(5).collect();
        if code.len() == 5 {
            return Some(code);
        }
    }
    let runtime_err = err.to_string();
    extract_postgres_code(&runtime_err)
}

fn extract_postgres_code(s: &str) -> Option<String> {
    let needle = "code: \"";
    if let Some(i) = s.find(needle) {
        let rest = &s[i + needle.len()..];
        let code: String = rest.chars().take_while(|c| *c != '"').collect();
        if !code.is_empty() {
            return Some(code);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_db_record_not_found_maps_to_not_found() {
        let err = sea_orm::DbErr::RecordNotFound("post".into());
        let app = from_db(err, "post");
        assert!(matches!(app, AppError::NotFound(_)));
        assert_eq!(app.status(), axum::http::StatusCode::NOT_FOUND);
    }

    #[test]
    fn from_db_unknown_becomes_internal() {
        let err = sea_orm::DbErr::Custom("boom".into());
        let app = from_db(err, "post");
        assert!(matches!(app, AppError::Internal(_)));
    }

    #[test]
    fn extract_postgres_code_finds_23505() {
        let s = r#"some error code: "23505" detail"#;
        assert_eq!(extract_postgres_code(s), Some("23505".into()));
    }

    #[test]
    fn extract_postgres_code_handles_no_match() {
        assert_eq!(extract_postgres_code("no code here"), None);
    }

    #[test]
    fn app_error_status_codes() {
        assert_eq!(
            AppError::Validation("x".into()).status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            AppError::NotFound("x".into()).status(),
            axum::http::StatusCode::NOT_FOUND
        );
        assert_eq!(
            AppError::Conflict("x".into()).status(),
            axum::http::StatusCode::CONFLICT
        );
        assert_eq!(
            AppError::Unauthorized("x".into()).status(),
            axum::http::StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            AppError::Forbidden("x".into()).status(),
            axum::http::StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn internal_detail_is_generic() {
        let err = AppError::Internal(anyhow::anyhow!("secret"));
        assert_eq!(err.detail(), "internal server error");
    }
}
