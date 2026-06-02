use std::env;

use anyhow::{bail, Context, Result};

pub fn required(key: &'static str) -> Result<String> {
    let v = env::var(key).with_context(|| format!("{key} is required"))?;
    if v.trim().is_empty() {
        bail!("{key} is required");
    }
    Ok(v)
}

pub fn int(key: &'static str, fallback: u32) -> u32 {
    match env::var(key) {
        Ok(v) if !v.trim().is_empty() => {
            v.parse::<u32>().ok().filter(|n| *n > 0).unwrap_or(fallback)
        }
        _ => fallback,
    }
}

pub fn string(key: &'static str, fallback: &str) -> String {
    match env::var(key) {
        Ok(v) if !v.trim().is_empty() => v,
        _ => fallback.to_owned(),
    }
}
