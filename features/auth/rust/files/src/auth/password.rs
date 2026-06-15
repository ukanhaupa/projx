use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;

use crate::auth::sha256::sha256;
use crate::error::AppError;

const ARGON_MEMORY_KIB: u32 = 64 * 1024;
const ARGON_ITERATIONS: u32 = 2;
const ARGON_PARALLELISM: u32 = 1;
const TOKEN_BYTES: usize = 32;

fn argon2() -> Result<Argon2<'static>, AppError> {
    let params = Params::new(ARGON_MEMORY_KIB, ARGON_ITERATIONS, ARGON_PARALLELISM, None)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("argon2 params: {e}")))?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = argon2()?
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("argon2 hash: {e}")))?;
    Ok(hash.to_string())
}

pub fn verify_password(password: &str, encoded: &str) -> bool {
    if encoded.is_empty() {
        return false;
    }
    let Ok(parsed) = PasswordHash::new(encoded) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

pub fn hash_token(token: &str) -> String {
    hex_encode(&sha256(token.as_bytes()))
}

pub fn random_token() -> Result<String, AppError> {
    let mut buf = [0u8; TOKEN_BYTES];
    rand::thread_rng().fill_bytes(&mut buf);
    Ok(hex_encode(&buf))
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(nibble(b >> 4));
        out.push(nibble(b & 0x0f));
    }
    out
}

fn nibble(n: u8) -> char {
    match n {
        0..=9 => (b'0' + n) as char,
        _ => (b'a' + (n - 10)) as char,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_then_verify_roundtrips() {
        let encoded = hash_password("hunter2hunter2").unwrap();
        assert!(encoded.starts_with("$argon2id$"));
        assert!(verify_password("hunter2hunter2", &encoded));
        assert!(!verify_password("wrong-password", &encoded));
    }

    #[test]
    fn verify_rejects_empty_and_malformed() {
        assert!(!verify_password("x", ""));
        assert!(!verify_password("x", "not-a-phc-string"));
        assert!(!verify_password("x", "$argon2id$bogus"));
    }

    #[test]
    fn hash_token_is_deterministic_sha256_hex() {
        let a = hash_token("abc");
        let b = hash_token("abc");
        assert_eq!(a, b);
        assert_eq!(a.len(), 64);
        assert_eq!(
            hash_token(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn random_token_is_unique_and_hex() {
        let a = random_token().unwrap();
        let b = random_token().unwrap();
        assert_ne!(a, b);
        assert_eq!(a.len(), TOKEN_BYTES * 2);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn hex_encode_known_vector() {
        assert_eq!(hex_encode(&[0x00, 0x0f, 0xff, 0xa0]), "000fffa0");
    }
}
