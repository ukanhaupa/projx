use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::error::AppError;

#[derive(Clone, Debug)]
pub enum Provider {
    SharedSecret(Vec<u8>),
    Jwks(String),
}

#[derive(Clone, Debug)]
pub struct VerifierConfig {
    pub provider: Provider,
    pub algorithms: Vec<Algorithm>,
    pub issuer: Option<String>,
    pub audience: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub sid: String,
    pub exp: Option<u64>,
    pub nbf: Option<u64>,
    pub iss: Option<String>,
    #[serde(default)]
    pub aud: serde_json::Value,
}

#[derive(Clone)]
pub struct Verifier {
    cfg: VerifierConfig,
    jwks_cache: Arc<RwLock<Option<JwksCache>>>,
}

struct JwksCache {
    keys: HashMap<String, DecodingKey>,
    fetched_at: Instant,
}

const JWKS_TTL: Duration = Duration::from_secs(600);

impl Verifier {
    pub fn new(cfg: VerifierConfig) -> Result<Self, AppError> {
        if cfg.algorithms.is_empty() {
            return Err(AppError::Validation(
                "auth: at least one algorithm is required".into(),
            ));
        }
        match &cfg.provider {
            Provider::SharedSecret(s) if s.is_empty() => {
                return Err(AppError::Validation(
                    "auth: JWT_SECRET is required when provider=shared_secret".into(),
                ));
            }
            Provider::Jwks(url) if url.is_empty() => {
                return Err(AppError::Validation(
                    "auth: JWT_JWKS_URL is required when provider=jwks".into(),
                ));
            }
            _ => {}
        }
        Ok(Self {
            cfg,
            jwks_cache: Arc::new(RwLock::new(None)),
        })
    }

    pub fn from_env() -> Result<Self, AppError> {
        let provider_name = std::env::var("JWT_PROVIDER").unwrap_or_default();
        let jwks_url = std::env::var("JWT_JWKS_URL").unwrap_or_default();
        let provider = if provider_name == "jwks"
            || (provider_name.is_empty() && !jwks_url.is_empty())
        {
            if jwks_url.is_empty() {
                return Err(AppError::Validation(
                    "JWT_JWKS_URL is required for jwks".into(),
                ));
            }
            Provider::Jwks(jwks_url)
        } else {
            let secret = std::env::var("JWT_SECRET").map_err(|_| {
                AppError::Validation("JWT_SECRET is required when provider=shared_secret".into())
            })?;
            Provider::SharedSecret(secret.into_bytes())
        };
        let algs = parse_algorithms(
            &std::env::var("JWT_ALGORITHMS").unwrap_or_default(),
            matches!(provider, Provider::SharedSecret(_)),
        )?;
        let issuer = std::env::var("JWT_ISSUER").ok().filter(|s| !s.is_empty());
        let audience = std::env::var("JWT_AUDIENCE").ok().filter(|s| !s.is_empty());
        Self::new(VerifierConfig {
            provider,
            algorithms: algs,
            issuer,
            audience,
        })
    }

    #[tracing::instrument(skip(self, token))]
    pub async fn verify(&self, token: &str) -> Result<Claims, AppError> {
        if token.is_empty() {
            return Err(AppError::Unauthorized("missing bearer token".into()));
        }
        let header =
            decode_header(token).map_err(|_| AppError::Unauthorized("malformed token".into()))?;
        if !self.cfg.algorithms.contains(&header.alg) {
            return Err(AppError::Unauthorized("algorithm not allowed".into()));
        }

        let key = match &self.cfg.provider {
            Provider::SharedSecret(s) => DecodingKey::from_secret(s),
            Provider::Jwks(url) => {
                let kid = header.kid.clone().ok_or_else(|| {
                    AppError::Unauthorized("token missing kid for jwks lookup".into())
                })?;
                self.resolve_jwks_key(url, &kid).await?
            }
        };

        let mut validation = Validation::new(header.alg);
        let allowed: HashSet<Algorithm> = self.cfg.algorithms.iter().copied().collect();
        validation.algorithms = allowed.into_iter().collect();
        validation.required_spec_claims = HashSet::from(["sub".to_string(), "exp".to_string()]);
        validation.validate_exp = true;
        validation.validate_nbf = true;
        if let Some(iss) = &self.cfg.issuer {
            validation.set_issuer(&[iss]);
        }
        if let Some(aud) = &self.cfg.audience {
            validation.set_audience(&[aud]);
        } else {
            validation.validate_aud = false;
        }

        let data = decode::<Claims>(token, &key, &validation).map_err(map_jwt_err)?;
        if data.claims.sub.is_empty() {
            return Err(AppError::Unauthorized("invalid token payload".into()));
        }
        Ok(data.claims)
    }

    async fn resolve_jwks_key(&self, _url: &str, kid: &str) -> Result<DecodingKey, AppError> {
        let cache = self.jwks_cache.read().await;
        if let Some(c) = cache.as_ref() {
            if c.fetched_at.elapsed() < JWKS_TTL {
                if let Some(k) = c.keys.get(kid) {
                    return Ok(k.clone());
                }
            }
        }
        Err(AppError::Unauthorized("jwks: kid not found".into()))
    }

    pub async fn install_jwks(&self, keys: HashMap<String, DecodingKey>) {
        let mut cache = self.jwks_cache.write().await;
        *cache = Some(JwksCache {
            keys,
            fetched_at: Instant::now(),
        });
    }
}

pub fn parse_algorithms(raw: &str, is_shared: bool) -> Result<Vec<Algorithm>, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(if is_shared {
            vec![Algorithm::HS256]
        } else {
            vec![Algorithm::RS256]
        });
    }
    let mut out = Vec::new();
    for raw_a in trimmed.split(',') {
        let a = raw_a.trim();
        if a.is_empty() {
            continue;
        }
        let alg = match a {
            "HS256" => Algorithm::HS256,
            "RS256" => Algorithm::RS256,
            other => {
                return Err(AppError::Validation(format!(
                    "JWT_ALGORITHMS: unsupported algorithm {other} (only HS256, RS256)"
                )))
            }
        };
        out.push(alg);
    }
    Ok(out)
}

fn map_jwt_err(err: jsonwebtoken::errors::Error) -> AppError {
    use jsonwebtoken::errors::ErrorKind as K;
    match err.kind() {
        K::ExpiredSignature => AppError::Unauthorized("token expired".into()),
        K::ImmatureSignature => AppError::Unauthorized("token not yet valid".into()),
        K::InvalidIssuer => AppError::Unauthorized("invalid token issuer".into()),
        K::InvalidAudience => AppError::Unauthorized("invalid token audience".into()),
        K::InvalidSignature => AppError::Unauthorized("invalid token signature".into()),
        K::InvalidAlgorithm => AppError::Unauthorized("algorithm not allowed".into()),
        K::MissingRequiredClaim(_) => AppError::Unauthorized("token missing required claim".into()),
        _ => AppError::Unauthorized("invalid or expired token".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    fn make_token(secret: &[u8], exp_offset: i64, iss: Option<&str>) -> String {
        let exp = (now_secs() as i64 + exp_offset) as u64;
        let claims = serde_json::json!({
            "sub": "user-1",
            "exp": exp,
            "iss": iss,
            "email": "a@b.com",
            "role": "admin",
            "permissions": ["read"],
            "sid": "sess-1"
        });
        encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(secret),
        )
        .unwrap()
    }

    fn shared(secret: &[u8]) -> Verifier {
        Verifier::new(VerifierConfig {
            provider: Provider::SharedSecret(secret.to_vec()),
            algorithms: vec![Algorithm::HS256],
            issuer: None,
            audience: None,
        })
        .unwrap()
    }

    #[tokio::test]
    async fn verifies_valid_hs256() {
        let v = shared(b"k");
        let tok = make_token(b"k", 60, None);
        let c = v.verify(&tok).await.unwrap();
        assert_eq!(c.sub, "user-1");
        assert_eq!(c.email, "a@b.com");
        assert_eq!(c.role, "admin");
        assert_eq!(c.permissions, vec!["read"]);
    }

    #[tokio::test]
    async fn rejects_expired_token() {
        let v = shared(b"k");
        let tok = make_token(b"k", -120, None);
        let err = v.verify(&tok).await.unwrap_err();
        assert_eq!(err.detail(), "token expired");
    }

    #[tokio::test]
    async fn rejects_wrong_secret() {
        let v = shared(b"right");
        let tok = make_token(b"wrong", 60, None);
        assert!(v.verify(&tok).await.is_err());
    }

    #[tokio::test]
    async fn rejects_disallowed_algorithm() {
        let v = Verifier::new(VerifierConfig {
            provider: Provider::SharedSecret(b"k".to_vec()),
            algorithms: vec![Algorithm::RS256],
            issuer: None,
            audience: None,
        })
        .unwrap();
        let tok = make_token(b"k", 60, None);
        let err = v.verify(&tok).await.unwrap_err();
        assert_eq!(err.detail(), "algorithm not allowed");
    }

    #[tokio::test]
    async fn enforces_issuer() {
        let v = Verifier::new(VerifierConfig {
            provider: Provider::SharedSecret(b"k".to_vec()),
            algorithms: vec![Algorithm::HS256],
            issuer: Some("good".into()),
            audience: None,
        })
        .unwrap();
        let bad = make_token(b"k", 60, Some("bad"));
        assert!(v.verify(&bad).await.is_err());
        let good = make_token(b"k", 60, Some("good"));
        assert!(v.verify(&good).await.is_ok());
    }

    #[tokio::test]
    async fn empty_token_unauthorized() {
        let v = shared(b"k");
        assert_eq!(
            v.verify("").await.unwrap_err().detail(),
            "missing bearer token"
        );
    }

    #[test]
    fn algorithms_parse_default_shared() {
        assert_eq!(parse_algorithms("", true).unwrap(), vec![Algorithm::HS256]);
    }

    #[test]
    fn algorithms_parse_default_jwks() {
        assert_eq!(parse_algorithms("", false).unwrap(), vec![Algorithm::RS256]);
    }

    #[test]
    fn algorithms_parse_explicit() {
        assert_eq!(
            parse_algorithms("HS256, RS256", true).unwrap(),
            vec![Algorithm::HS256, Algorithm::RS256]
        );
    }

    #[test]
    fn algorithms_reject_unknown() {
        assert!(parse_algorithms("ES256", true).is_err());
    }

    #[test]
    fn new_validates_empty_algorithms() {
        assert!(Verifier::new(VerifierConfig {
            provider: Provider::SharedSecret(b"k".to_vec()),
            algorithms: vec![],
            issuer: None,
            audience: None,
        })
        .is_err());
    }

    #[test]
    fn new_validates_empty_secret() {
        assert!(Verifier::new(VerifierConfig {
            provider: Provider::SharedSecret(vec![]),
            algorithms: vec![Algorithm::HS256],
            issuer: None,
            audience: None,
        })
        .is_err());
    }

    #[test]
    fn new_validates_empty_jwks_url() {
        assert!(Verifier::new(VerifierConfig {
            provider: Provider::Jwks(String::new()),
            algorithms: vec![Algorithm::RS256],
            issuer: None,
            audience: None,
        })
        .is_err());
    }
}
