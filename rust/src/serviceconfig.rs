use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use tokio::sync::Mutex;

use crate::error::AppError;

const IV_LEN: usize = 12;
const TAG_LEN: usize = 16;
const DEFAULT_TTL_SECS: u64 = 600;

#[derive(Clone)]
pub struct ServiceConfig {
    db: Arc<DatabaseConnection>,
    key: Arc<[u8; 32]>,
    ttl: Duration,
    cache: Arc<Mutex<HashMap<String, CacheEntry>>>,
}

#[derive(Clone)]
struct CacheEntry {
    value: String,
    expires_at: Instant,
}

impl ServiceConfig {
    pub fn new(db: Arc<DatabaseConnection>) -> Result<Self, AppError> {
        let raw = std::env::var("CRED_ENCRYPTION_KEY").map_err(|_| {
            AppError::Validation(
                "CRED_ENCRYPTION_KEY is required (base64-encoded 32-byte key)".into(),
            )
        })?;
        let bytes = B64.decode(raw.as_bytes()).map_err(|e| {
            AppError::Internal(anyhow::anyhow!("CRED_ENCRYPTION_KEY base64 decode: {e}"))
        })?;
        if bytes.len() != 32 {
            return Err(AppError::Validation(format!(
                "CRED_ENCRYPTION_KEY must decode to 32 bytes (got {})",
                bytes.len()
            )));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        let ttl = std::env::var("CONFIG_CACHE_TTL_SECONDS")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(DEFAULT_TTL_SECS);
        Ok(Self {
            db,
            key: Arc::new(key),
            ttl: Duration::from_secs(ttl),
            cache: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    #[tracing::instrument(skip(self))]
    pub async fn get(&self, key: &str) -> Result<String, AppError> {
        {
            let cache = self.cache.lock().await;
            if let Some(entry) = cache.get(key) {
                if entry.expires_at > Instant::now() {
                    return Ok(entry.value.clone());
                }
            }
        }
        let stmt = Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT config FROM service_configs WHERE purpose = $1 AND is_active = true LIMIT 1",
            [key.into()],
        );
        let row = self
            .db
            .query_one(stmt)
            .await
            .map_err(|e| crate::apperr::from_db(e, "service_config"))?;
        let row = row.ok_or_else(|| AppError::NotFound(format!("service_config:{key}")))?;
        let payload: String = row
            .try_get::<String>("", "config")
            .map_err(|e| AppError::Internal(anyhow::anyhow!("decode service_config: {e}")))?;
        let plaintext = decrypt(self.key.as_ref(), &payload)?;
        let mut cache = self.cache.lock().await;
        cache.insert(
            key.to_string(),
            CacheEntry {
                value: plaintext.clone(),
                expires_at: Instant::now() + self.ttl,
            },
        );
        Ok(plaintext)
    }

    #[tracing::instrument(skip(self, value))]
    pub async fn set(&self, key: &str, value: &str) -> Result<(), AppError> {
        let encrypted = encrypt(self.key.as_ref(), value)?;
        let stmt = Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "INSERT INTO service_configs (purpose, config, is_active) VALUES ($1, $2, true) \
             ON CONFLICT (purpose) DO UPDATE SET config = EXCLUDED.config, is_active = true",
            [key.into(), encrypted.into()],
        );
        self.db
            .execute(stmt)
            .await
            .map_err(|e| crate::apperr::from_db(e, "service_config"))?;
        self.invalidate(key).await;
        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn delete(&self, key: &str) -> Result<(), AppError> {
        let stmt = Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "DELETE FROM service_configs WHERE purpose = $1",
            [key.into()],
        );
        let res = self
            .db
            .execute(stmt)
            .await
            .map_err(|e| crate::apperr::from_db(e, "service_config"))?;
        if res.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("service_config:{key}")));
        }
        self.invalidate(key).await;
        Ok(())
    }

    pub async fn invalidate(&self, key: &str) {
        let mut cache = self.cache.lock().await;
        cache.remove(key);
    }

    pub async fn invalidate_all(&self) {
        let mut cache = self.cache.lock().await;
        cache.clear();
    }
}

pub fn encrypt(key: &[u8; 32], plaintext: &str) -> Result<String, AppError> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("aes init: {e}")))?;
    let mut iv = [0u8; IV_LEN];
    rand::thread_rng().fill_bytes(&mut iv);
    let nonce = Nonce::from_slice(&iv);
    let sealed = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext.as_bytes(),
                aad: b"",
            },
        )
        .map_err(|e| AppError::Internal(anyhow::anyhow!("aes encrypt: {e}")))?;
    if sealed.len() < TAG_LEN {
        return Err(AppError::Internal(anyhow::anyhow!(
            "sealed shorter than tag length"
        )));
    }
    let split = sealed.len() - TAG_LEN;
    let ct = &sealed[..split];
    let tag = &sealed[split..];
    let mut out = Vec::with_capacity(IV_LEN + TAG_LEN + ct.len());
    out.extend_from_slice(&iv);
    out.extend_from_slice(tag);
    out.extend_from_slice(ct);
    Ok(B64.encode(out))
}

pub fn decrypt(key: &[u8; 32], payload: &str) -> Result<String, AppError> {
    let buf = B64
        .decode(payload.as_bytes())
        .map_err(|e| AppError::Internal(anyhow::anyhow!("base64 decode: {e}")))?;
    if buf.len() < IV_LEN + TAG_LEN {
        return Err(AppError::Internal(anyhow::anyhow!("ciphertext too short")));
    }
    let iv = &buf[..IV_LEN];
    let tag = &buf[IV_LEN..IV_LEN + TAG_LEN];
    let ct = &buf[IV_LEN + TAG_LEN..];
    let mut sealed = Vec::with_capacity(ct.len() + TAG_LEN);
    sealed.extend_from_slice(ct);
    sealed.extend_from_slice(tag);
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("aes init: {e}")))?;
    let nonce = Nonce::from_slice(iv);
    let pt = cipher
        .decrypt(
            nonce,
            Payload {
                msg: &sealed,
                aad: b"",
            },
        )
        .map_err(|e| AppError::Internal(anyhow::anyhow!("aes decrypt: {e}")))?;
    String::from_utf8(pt).map_err(|e| AppError::Internal(anyhow::anyhow!("utf8: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nist_gcm_tc13_empty_plaintext_zero_key() {
        let key = [0u8; 32];
        let iv = [0u8; 12];
        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let sealed = cipher
            .encrypt(Nonce::from_slice(&iv), Payload { msg: &[], aad: b"" })
            .unwrap();
        let expected_tag = hex_decode("530f8afbc74536b9a963b4f1c4cb738b");
        assert_eq!(sealed, expected_tag);
    }

    fn hex_decode(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    #[test]
    fn round_trip_arbitrary_text() {
        let key = [7u8; 32];
        let blob = encrypt(&key, "hunter2 hunter2").unwrap();
        let back = decrypt(&key, &blob).unwrap();
        assert_eq!(back, "hunter2 hunter2");
    }

    #[test]
    fn wire_format_iv_tag_ct() {
        let key = [9u8; 32];
        let blob = encrypt(&key, "hello").unwrap();
        let raw = B64.decode(blob).unwrap();
        assert!(raw.len() >= IV_LEN + TAG_LEN);
        assert_eq!(raw.len(), IV_LEN + TAG_LEN + "hello".len());
    }

    #[test]
    fn decrypt_rejects_short_buffer() {
        let key = [1u8; 32];
        let bad = B64.encode([0u8; 10]);
        assert!(decrypt(&key, &bad).is_err());
    }

    #[test]
    fn decrypt_rejects_tampered_tag() {
        let key = [3u8; 32];
        let blob = encrypt(&key, "payload").unwrap();
        let mut raw = B64.decode(blob).unwrap();
        raw[IV_LEN] ^= 0x01;
        let tampered = B64.encode(raw);
        assert!(decrypt(&key, &tampered).is_err());
    }

    #[test]
    fn cross_stack_known_layout_decrypts() {
        let key = [0u8; 32];
        let iv = [0u8; 12];
        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let sealed = cipher
            .encrypt(
                Nonce::from_slice(&iv),
                Payload {
                    msg: b"projx",
                    aad: b"",
                },
            )
            .unwrap();
        let split = sealed.len() - TAG_LEN;
        let ct = &sealed[..split];
        let tag = &sealed[split..];
        let mut wire = Vec::with_capacity(IV_LEN + TAG_LEN + ct.len());
        wire.extend_from_slice(&iv);
        wire.extend_from_slice(tag);
        wire.extend_from_slice(ct);
        let payload = B64.encode(wire);
        assert_eq!(decrypt(&key, &payload).unwrap(), "projx");
    }
}
