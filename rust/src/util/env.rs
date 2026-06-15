use std::env;

use anyhow::{bail, Context, Result};

pub fn required(key: &'static str) -> Result<String> {
    let v = env::var(key).with_context(|| format!("{key} is required"))?;
    require_non_blank(key, v)
}

fn require_non_blank(key: &'static str, value: String) -> Result<String> {
    if value.trim().is_empty() {
        bail!("{key} is required");
    }
    Ok(value)
}

pub fn int(key: &'static str, fallback: u32) -> u32 {
    resolve_int(env::var(key).ok().as_deref(), fallback)
}

fn resolve_int(raw: Option<&str>, fallback: u32) -> u32 {
    match raw {
        Some(v) if !v.trim().is_empty() => {
            v.parse::<u32>().ok().filter(|n| *n > 0).unwrap_or(fallback)
        }
        _ => fallback,
    }
}

pub fn string(key: &'static str, fallback: &str) -> String {
    resolve_string(env::var(key).ok().as_deref(), fallback)
}

fn resolve_string(raw: Option<&str>, fallback: &str) -> String {
    match raw {
        Some(v) if !v.trim().is_empty() => v.to_owned(),
        _ => fallback.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn require_non_blank_accepts_value() {
        assert_eq!(
            require_non_blank("KEY", "value-here".to_string()).unwrap(),
            "value-here"
        );
    }

    #[test]
    fn require_non_blank_rejects_empty() {
        let err = require_non_blank("KEY", String::new()).unwrap_err();
        assert!(err.to_string().contains("KEY is required"));
    }

    #[test]
    fn require_non_blank_rejects_whitespace() {
        let err = require_non_blank("KEY", "   ".to_string()).unwrap_err();
        assert!(err.to_string().contains("KEY is required"));
    }

    #[test]
    fn resolve_int_parses_positive() {
        assert_eq!(resolve_int(Some("42"), 7), 42);
    }

    #[test]
    fn resolve_int_rejects_zero() {
        assert_eq!(resolve_int(Some("0"), 7), 7);
    }

    #[test]
    fn resolve_int_rejects_non_numeric() {
        assert_eq!(resolve_int(Some("abc"), 9), 9);
    }

    #[test]
    fn resolve_int_rejects_negative() {
        assert_eq!(resolve_int(Some("-5"), 9), 9);
    }

    #[test]
    fn resolve_int_falls_back_on_blank_and_absent() {
        assert_eq!(resolve_int(Some("   "), 3), 3);
        assert_eq!(resolve_int(None, 5), 5);
    }

    #[test]
    fn resolve_string_returns_value() {
        assert_eq!(resolve_string(Some("hello"), "fallback"), "hello");
    }

    #[test]
    fn resolve_string_trims_check_keeps_inner_spaces() {
        assert_eq!(resolve_string(Some("a b"), "fallback"), "a b");
    }

    #[test]
    fn resolve_string_falls_back_on_blank_and_absent() {
        assert_eq!(resolve_string(Some("   "), "fallback"), "fallback");
        assert_eq!(resolve_string(None, "default-val"), "default-val");
    }
}
