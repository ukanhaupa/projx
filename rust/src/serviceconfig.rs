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
        Self::from_parts(
            db,
            std::env::var("CRED_ENCRYPTION_KEY").ok(),
            std::env::var("CONFIG_CACHE_TTL_SECONDS").ok(),
        )
    }

    fn from_parts(
        db: Arc<DatabaseConnection>,
        raw_key: Option<String>,
        ttl_raw: Option<String>,
    ) -> Result<Self, AppError> {
        let raw = raw_key.ok_or_else(|| {
            AppError::Validation(
                "CRED_ENCRYPTION_KEY is required (base64-encoded 32-byte key)".into(),
            )
        })?;
        let key = decode_key(&raw)?;
        let ttl = ttl_raw
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

fn decode_key(raw: &str) -> Result<[u8; 32], AppError> {
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
    Ok(key)
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
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

    fn mock_arc() -> Arc<DatabaseConnection> {
        Arc::new(MockDatabase::new(DatabaseBackend::Postgres).into_connection())
    }

    fn svc_with(db: DatabaseConnection, key: [u8; 32], ttl_secs: u64) -> ServiceConfig {
        ServiceConfig {
            db: Arc::new(db),
            key: Arc::new(key),
            ttl: Duration::from_secs(ttl_secs),
            cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn stored_blob(key: &[u8; 32], plaintext: &str) -> String {
        encrypt(key, plaintext).unwrap()
    }

    fn expect_err(res: Result<ServiceConfig, AppError>) -> AppError {
        match res {
            Ok(_) => panic!("expected ServiceConfig construction to fail"),
            Err(e) => e,
        }
    }

    #[test]
    fn decode_key_rejects_bad_base64() {
        assert!(matches!(
            decode_key("!!!not base64!!!").unwrap_err(),
            AppError::Internal(_)
        ));
    }

    #[test]
    fn decode_key_rejects_wrong_length() {
        let err = decode_key(&B64.encode([0u8; 16])).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn decode_key_accepts_32_bytes() {
        assert_eq!(decode_key(&B64.encode([7u8; 32])).unwrap(), [7u8; 32]);
    }

    #[test]
    fn from_parts_rejects_missing_key() {
        assert!(matches!(
            expect_err(ServiceConfig::from_parts(mock_arc(), None, None)),
            AppError::Validation(_)
        ));
    }

    #[test]
    fn from_parts_rejects_bad_base64() {
        let err = expect_err(ServiceConfig::from_parts(
            mock_arc(),
            Some("!!!not base64!!!".into()),
            None,
        ));
        assert!(matches!(err, AppError::Internal(_)));
    }

    #[test]
    fn from_parts_defaults_ttl_when_absent_or_garbage() {
        let cfg = ServiceConfig::from_parts(mock_arc(), Some(B64.encode([3u8; 32])), None).unwrap();
        assert_eq!(cfg.ttl, Duration::from_secs(DEFAULT_TTL_SECS));
        let cfg2 = ServiceConfig::from_parts(
            mock_arc(),
            Some(B64.encode([3u8; 32])),
            Some("not-a-number".into()),
        )
        .unwrap();
        assert_eq!(cfg2.ttl, Duration::from_secs(DEFAULT_TTL_SECS));
    }

    #[test]
    fn from_parts_honours_custom_ttl() {
        let cfg =
            ServiceConfig::from_parts(mock_arc(), Some(B64.encode([4u8; 32])), Some("30".into()))
                .unwrap();
        assert_eq!(cfg.ttl, Duration::from_secs(30));
    }

    #[tokio::test]
    async fn get_decrypts_db_row_and_caches() {
        let key = [11u8; 32];
        let blob = stored_blob(&key, "smtp-password");
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![maplit_row(&blob)]])
            .into_connection();
        let svc = svc_with(db, key, 600);
        let got = svc.get("smtp").await.unwrap();
        assert_eq!(got, "smtp-password");
        let cache = svc.cache.lock().await;
        assert!(cache.contains_key("smtp"));
    }

    #[tokio::test]
    async fn get_serves_from_cache_without_db_hit() {
        let key = [12u8; 32];
        let db = MockDatabase::new(DatabaseBackend::Postgres).into_connection();
        let svc = svc_with(db, key, 600);
        {
            let mut cache = svc.cache.lock().await;
            cache.insert(
                "jwt".to_string(),
                CacheEntry {
                    value: "cached-secret".into(),
                    expires_at: Instant::now() + Duration::from_secs(600),
                },
            );
        }
        assert_eq!(svc.get("jwt").await.unwrap(), "cached-secret");
    }

    #[tokio::test]
    async fn get_refetches_after_ttl_expiry() {
        let key = [13u8; 32];
        let blob = stored_blob(&key, "fresh-from-db");
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![maplit_row(&blob)]])
            .into_connection();
        let svc = svc_with(db, key, 600);
        {
            let mut cache = svc.cache.lock().await;
            cache.insert(
                "stale".to_string(),
                CacheEntry {
                    value: "old-value".into(),
                    expires_at: Instant::now() - Duration::from_secs(1),
                },
            );
        }
        assert_eq!(svc.get("stale").await.unwrap(), "fresh-from-db");
    }

    #[tokio::test]
    async fn get_missing_row_is_not_found() {
        let key = [14u8; 32];
        let empty: Vec<std::collections::BTreeMap<String, sea_orm::Value>> = vec![];
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([empty])
            .into_connection();
        let svc = svc_with(db, key, 600);
        let err = svc.get("absent").await.unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[tokio::test]
    async fn set_encrypts_persists_and_invalidates() {
        let key = [15u8; 32];
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        let svc = svc_with(db, key, 600);
        {
            let mut cache = svc.cache.lock().await;
            cache.insert(
                "smtp".to_string(),
                CacheEntry {
                    value: "stale".into(),
                    expires_at: Instant::now() + Duration::from_secs(600),
                },
            );
        }
        svc.set("smtp", "new-password").await.unwrap();
        let cache = svc.cache.lock().await;
        assert!(!cache.contains_key("smtp"));
    }

    #[tokio::test]
    async fn delete_removes_row_and_cache() {
        let key = [16u8; 32];
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        let svc = svc_with(db, key, 600);
        {
            let mut cache = svc.cache.lock().await;
            cache.insert(
                "smtp".to_string(),
                CacheEntry {
                    value: "x".into(),
                    expires_at: Instant::now() + Duration::from_secs(600),
                },
            );
        }
        svc.delete("smtp").await.unwrap();
        let cache = svc.cache.lock().await;
        assert!(!cache.contains_key("smtp"));
    }

    #[tokio::test]
    async fn delete_missing_is_not_found() {
        let key = [17u8; 32];
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 0,
            }])
            .into_connection();
        let svc = svc_with(db, key, 600);
        let err = svc.delete("absent").await.unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[tokio::test]
    async fn invalidate_all_clears_cache() {
        let key = [18u8; 32];
        let db = MockDatabase::new(DatabaseBackend::Postgres).into_connection();
        let svc = svc_with(db, key, 600);
        {
            let mut cache = svc.cache.lock().await;
            for k in ["a", "b", "c"] {
                cache.insert(
                    k.to_string(),
                    CacheEntry {
                        value: "v".into(),
                        expires_at: Instant::now() + Duration::from_secs(600),
                    },
                );
            }
        }
        svc.invalidate_all().await;
        assert!(svc.cache.lock().await.is_empty());
    }

    #[tokio::test]
    async fn get_then_set_round_trips_through_db() {
        let key = [21u8; 32];
        let blob = stored_blob(&key, "secret-v1");
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![maplit_row(&blob)]])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        let svc = svc_with(db, key, 600);
        assert_eq!(svc.get("k").await.unwrap(), "secret-v1");
        svc.set("k", "secret-v2").await.unwrap();
        assert!(!svc.cache.lock().await.contains_key("k"));
    }

    fn maplit_row(config: &str) -> std::collections::BTreeMap<String, sea_orm::Value> {
        let mut row = std::collections::BTreeMap::new();
        row.insert("config".to_string(), sea_orm::Value::from(config));
        row
    }

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
