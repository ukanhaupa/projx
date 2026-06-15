use std::time::{SystemTime, UNIX_EPOCH};

use base32::Alphabet;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use totp_rs::{Algorithm, TOTP};

use crate::auth::password::{hash_password, verify_password};
use crate::error::AppError;

pub const MFA_MAX_ATTEMPTS: i32 = 5;
pub const MFA_LOCKOUT_MINUTES: i64 = 15;

const RECOVERY_CODE_COUNT: usize = 10;
const RECOVERY_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TOTP_DIGITS: usize = 6;
const TOTP_STEP_SECONDS: u64 = 30;
const TOTP_SKEW: u8 = 3;
const SECRET_BYTES: usize = 20;

pub fn mfa_issuer() -> String {
    match std::env::var("MFA_ISSUER") {
        Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => "projx".to_string(),
    }
}

pub fn generate_secret() -> String {
    let mut buf = [0u8; SECRET_BYTES];
    rand::thread_rng().fill_bytes(&mut buf);
    base32::encode(Alphabet::Rfc4648 { padding: false }, &buf)
}

fn totp_for(secret: &str) -> Result<TOTP, AppError> {
    let bytes = base32::decode(Alphabet::Rfc4648 { padding: false }, secret)
        .ok_or_else(|| AppError::Validation("mfa secret is not valid base32".into()))?;
    TOTP::new(
        Algorithm::SHA1,
        TOTP_DIGITS,
        TOTP_SKEW,
        TOTP_STEP_SECONDS,
        bytes,
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!("totp init: {e}")))
}

pub fn build_otpauth_url(email: &str, secret: &str) -> Result<String, AppError> {
    if base32::decode(Alphabet::Rfc4648 { padding: false }, secret).is_none() {
        return Err(AppError::Validation(
            "mfa secret is not valid base32".into(),
        ));
    }
    let issuer = mfa_issuer();
    let label = pathencode(&format!("{issuer}:{email}"));
    Ok(format!(
        "otpauth://totp/{label}?secret={}&issuer={}&algorithm=SHA1&digits={}&period={}",
        secret,
        queryencode(&issuer),
        TOTP_DIGITS,
        TOTP_STEP_SECONDS,
    ))
}

fn pathencode(s: &str) -> String {
    encode_with(s, |b| matches!(b, b'/' | b'?' | b'#' | b'%' | b' '))
}

fn queryencode(s: &str) -> String {
    encode_with(
        s,
        |b| !matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~'),
    )
}

fn encode_with(s: &str, should_escape: impl Fn(u8) -> bool) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if should_escape(b) {
            out.push_str(&format!("%{b:02X}"));
        } else {
            out.push(b as char);
        }
    }
    out
}

pub fn verify_totp(code: &str, secret: &str) -> bool {
    let cleaned = code.trim();
    if cleaned.is_empty() || secret.is_empty() {
        return false;
    }
    let Ok(totp) = totp_for(secret) else {
        return false;
    };
    let now = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_secs(),
        Err(_) => return false,
    };
    totp.check(cleaned, now)
}

pub fn generate_recovery_codes() -> Vec<String> {
    (0..RECOVERY_CODE_COUNT)
        .map(|_| format!("{}-{}", pick_chars(4), pick_chars(4)))
        .collect()
}

fn pick_chars(n: usize) -> String {
    let mut rng = rand::thread_rng();
    let mut out = String::with_capacity(n);
    for _ in 0..n {
        let idx = (rng.next_u32() as usize) % RECOVERY_ALPHABET.len();
        out.push(RECOVERY_ALPHABET[idx] as char);
    }
    out
}

fn denormalize(code: &str) -> String {
    let stripped: String = code
        .trim()
        .to_uppercase()
        .chars()
        .filter(|c| *c != ' ' && *c != '-')
        .collect();
    if stripped.len() < 5 {
        return stripped;
    }
    format!("{}-{}", &stripped[..4], &stripped[4..])
}

pub fn hash_recovery_codes(codes: &[String]) -> Result<Vec<String>, AppError> {
    codes
        .iter()
        .map(|c| hash_password(&denormalize(c)))
        .collect()
}

pub fn match_recovery_code(input: &str, hashes: &[String]) -> Option<usize> {
    let normalized = denormalize(input);
    hashes.iter().position(|h| verify_password(&normalized, h))
}

#[derive(Serialize, Deserialize)]
struct RecoveryEnvelope {
    hashes: Vec<String>,
}

pub fn encode_recovery_hashes(hashes: &[String]) -> Result<String, AppError> {
    serde_json::to_string(&RecoveryEnvelope {
        hashes: hashes.to_vec(),
    })
    .map_err(|e| AppError::Internal(anyhow::anyhow!("encode recovery: {e}")))
}

pub fn decode_recovery_hashes(payload: &str) -> Vec<String> {
    if payload.is_empty() {
        return Vec::new();
    }
    serde_json::from_str::<RecoveryEnvelope>(payload)
        .map(|e| e.hashes)
        .unwrap_or_default()
}

#[derive(Serialize, Deserialize)]
struct SecretEnvelope {
    secret: String,
}

pub fn encode_secret(secret: &str) -> Result<String, AppError> {
    serde_json::to_string(&SecretEnvelope {
        secret: secret.to_string(),
    })
    .map_err(|e| AppError::Internal(anyhow::anyhow!("encode secret: {e}")))
}

pub fn decode_secret(payload: &str) -> Result<String, AppError> {
    if payload.is_empty() {
        return Err(AppError::Validation("mfa secret missing".into()));
    }
    let env: SecretEnvelope = serde_json::from_str(payload)
        .map_err(|_| AppError::Validation("mfa secret payload malformed".into()))?;
    if env.secret.is_empty() {
        return Err(AppError::Validation("mfa secret payload malformed".into()));
    }
    Ok(env.secret)
}

pub fn is_mfa_locked(locked_until: Option<chrono::DateTime<chrono::Utc>>) -> bool {
    match locked_until {
        Some(t) => t > chrono::Utc::now(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn current_code(secret: &str) -> String {
        let totp = totp_for(secret).unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        totp.generate(now)
    }

    #[test]
    fn generate_secret_is_base32_and_decodable() {
        let s = generate_secret();
        assert!(!s.is_empty());
        assert!(base32::decode(Alphabet::Rfc4648 { padding: false }, &s).is_some());
    }

    #[test]
    fn verify_totp_accepts_current_and_rejects_wrong() {
        let secret = generate_secret();
        let code = current_code(&secret);
        assert!(verify_totp(&code, &secret));
        assert!(!verify_totp("000000", &secret) || verify_totp(&code, &secret));
        assert!(!verify_totp("", &secret));
        assert!(!verify_totp(&code, ""));
    }

    #[test]
    fn verify_totp_rejects_bad_secret() {
        assert!(!verify_totp("123456", "not base32 !!!"));
    }

    #[test]
    fn otpauth_url_contains_issuer_and_email() {
        let _guard = crate::auth::service::ENV_LOCK.lock().unwrap();
        std::env::remove_var("MFA_ISSUER");
        let secret = generate_secret();
        let url = build_otpauth_url("user@example.com", &secret).unwrap();
        assert!(url.starts_with("otpauth://totp/"));
        assert!(url.contains("projx"));
        assert!(url.contains("secret="));
    }

    #[test]
    fn recovery_codes_generated_count_and_format() {
        let codes = generate_recovery_codes();
        assert_eq!(codes.len(), RECOVERY_CODE_COUNT);
        for c in &codes {
            assert_eq!(c.len(), 9);
            assert_eq!(c.as_bytes()[4], b'-');
        }
    }

    #[test]
    fn recovery_hash_and_match_roundtrip() {
        let codes = generate_recovery_codes();
        let hashes = hash_recovery_codes(&codes).unwrap();
        let idx = match_recovery_code(&codes[2], &hashes);
        assert_eq!(idx, Some(2));
        let lower = codes[5].to_lowercase();
        assert_eq!(match_recovery_code(&lower, &hashes), Some(5));
        assert_eq!(match_recovery_code("XXXX-YYYY", &hashes), None);
    }

    #[test]
    fn recovery_match_handles_spaces_and_missing_dash() {
        let codes = generate_recovery_codes();
        let hashes = hash_recovery_codes(&codes).unwrap();
        let raw = codes[0].replace('-', "");
        assert_eq!(match_recovery_code(&raw, &hashes), Some(0));
    }

    #[test]
    fn encode_decode_recovery_hashes_roundtrip() {
        let hashes = vec!["h1".to_string(), "h2".to_string()];
        let enc = encode_recovery_hashes(&hashes).unwrap();
        assert_eq!(decode_recovery_hashes(&enc), hashes);
        assert!(decode_recovery_hashes("").is_empty());
        assert!(decode_recovery_hashes("garbage").is_empty());
    }

    #[test]
    fn encode_decode_secret_roundtrip() {
        let enc = encode_secret("SEKRET").unwrap();
        assert_eq!(decode_secret(&enc).unwrap(), "SEKRET");
        assert!(decode_secret("").is_err());
        assert!(decode_secret("not-json").is_err());
        assert!(decode_secret("{\"secret\":\"\"}").is_err());
    }

    #[test]
    fn is_mfa_locked_logic() {
        assert!(!is_mfa_locked(None));
        assert!(is_mfa_locked(Some(
            chrono::Utc::now() + chrono::Duration::minutes(5)
        )));
        assert!(!is_mfa_locked(Some(
            chrono::Utc::now() - chrono::Duration::minutes(5)
        )));
    }

    #[test]
    fn mfa_issuer_defaults_to_projx() {
        let _guard = crate::auth::service::ENV_LOCK.lock().unwrap();
        std::env::remove_var("MFA_ISSUER");
        assert_eq!(mfa_issuer(), "projx");
    }
}
