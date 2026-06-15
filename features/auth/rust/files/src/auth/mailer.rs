use std::sync::Arc;

use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use serde::Deserialize;
use tokio::sync::RwLock;

use crate::serviceconfig::ServiceConfig;

const SMTP_CONFIG_KEY: &str = "smtp";

#[derive(Clone, Deserialize)]
struct SmtpConfig {
    host: String,
    #[serde(default = "default_port")]
    port: u16,
    #[serde(default)]
    user: String,
    #[serde(default)]
    pass: String,
    #[serde(default)]
    from: String,
    #[serde(default)]
    secure: bool,
}

fn default_port() -> u16 {
    587
}

#[derive(Clone)]
pub struct Mailer {
    config: Option<Arc<ServiceConfig>>,
    smtp: Arc<RwLock<Option<SmtpConfig>>>,
}

impl Mailer {
    pub fn new(config: Option<Arc<ServiceConfig>>) -> Self {
        Self {
            config,
            smtp: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn load(&self) {
        let Some(cfg) = &self.config else {
            return;
        };
        let Ok(raw) = cfg.get(SMTP_CONFIG_KEY).await else {
            tracing::warn!("[mailer] no SMTP config in service_configs — emails will be logged");
            return;
        };
        match serde_json::from_str::<SmtpConfig>(&raw) {
            Ok(parsed) if !parsed.host.is_empty() => {
                *self.smtp.write().await = Some(parsed);
                tracing::info!("[mailer] SMTP configured");
            }
            Ok(_) => {
                tracing::warn!(
                    "[mailer] SMTP config present but host empty — emails will be logged"
                )
            }
            Err(e) => {
                tracing::warn!(error = %e, "[mailer] SMTP config decode failed — emails will be logged")
            }
        }
    }

    pub async fn send_verification(&self, to: &str, link: &str) {
        let body = format!(
            "Confirm your email by visiting this link (expires in 24 hours):\n\n{link}\n\nIf you didn't create this account, ignore this email."
        );
        self.send(to, "Verify your email", &body).await;
    }

    pub async fn send_password_reset(&self, to: &str, link: &str) {
        let body = format!(
            "Reset your password using this link (expires in 30 minutes):\n\n{link}\n\nIf you didn't request this, ignore this email."
        );
        self.send(to, "Reset your password", &body).await;
    }

    async fn send(&self, to: &str, subject: &str, body: &str) {
        let cfg = { self.smtp.read().await.clone() };
        let Some(cfg) = cfg else {
            tracing::info!(to, subject, "[mailer:dev] email logged");
            return;
        };
        if let Err(e) = self.deliver(&cfg, to, subject, body).await {
            tracing::error!(to, subject, error = %e, "[mailer] send failed");
        } else {
            tracing::info!(to, subject, "[mailer] sent");
        }
    }

    async fn deliver(
        &self,
        cfg: &SmtpConfig,
        to: &str,
        subject: &str,
        body: &str,
    ) -> Result<(), anyhow::Error> {
        let from = if cfg.from.is_empty() {
            default_from()
        } else {
            cfg.from.clone()
        };
        let email = Message::builder()
            .from(from.parse()?)
            .to(to.parse()?)
            .subject(subject)
            .header(ContentType::TEXT_PLAIN)
            .body(body.to_string())?;

        let mut builder =
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&cfg.host).port(cfg.port);
        if cfg.secure {
            builder = builder.tls(Tls::Wrapper(TlsParameters::new(cfg.host.clone())?));
        } else {
            builder = builder.tls(Tls::Opportunistic(TlsParameters::new(cfg.host.clone())?));
        }
        if !cfg.user.is_empty() && !cfg.pass.is_empty() {
            builder = builder.credentials(Credentials::new(cfg.user.clone(), cfg.pass.clone()));
        }
        let transport = builder.build();
        transport.send(email).await?;
        Ok(())
    }
}

pub fn frontend_url() -> String {
    match std::env::var("FRONTEND_URL") {
        Ok(v) if !v.trim().is_empty() => v.trim().trim_end_matches('/').to_string(),
        _ => "http://localhost:5173".to_string(),
    }
}

pub fn build_verification_link(token: &str) -> String {
    build_link("/verify-email", token)
}

pub fn build_reset_link(token: &str) -> String {
    build_link("/reset-password", token)
}

fn build_link(path: &str, token: &str) -> String {
    format!("{}{}?token={}", frontend_url(), path, urlencode(token))
}

fn default_from() -> String {
    let base = frontend_url();
    let host = base
        .strip_prefix("https://")
        .or_else(|| base.strip_prefix("http://"))
        .unwrap_or(&base)
        .split('/')
        .next()
        .unwrap_or("localhost")
        .split(':')
        .next()
        .unwrap_or("localhost");
    format!("noreply@{host}")
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontend_url_defaults_and_trims() {
        let _guard = crate::auth::service::ENV_LOCK.lock().unwrap();
        std::env::remove_var("FRONTEND_URL");
        assert_eq!(frontend_url(), "http://localhost:5173");
        std::env::set_var("FRONTEND_URL", "https://app.example.com/");
        assert_eq!(frontend_url(), "https://app.example.com");
        std::env::remove_var("FRONTEND_URL");
    }

    #[test]
    fn links_include_token_query() {
        let _guard = crate::auth::service::ENV_LOCK.lock().unwrap();
        std::env::remove_var("FRONTEND_URL");
        assert_eq!(
            build_verification_link("abc"),
            "http://localhost:5173/verify-email?token=abc"
        );
        assert_eq!(
            build_reset_link("a b"),
            "http://localhost:5173/reset-password?token=a%20b"
        );
    }

    #[test]
    fn default_from_derives_host() {
        let _guard = crate::auth::service::ENV_LOCK.lock().unwrap();
        std::env::set_var("FRONTEND_URL", "https://mail.example.com");
        assert_eq!(default_from(), "noreply@mail.example.com");
        std::env::remove_var("FRONTEND_URL");
        assert_eq!(default_from(), "noreply@localhost");
    }

    #[test]
    fn urlencode_escapes_reserved() {
        assert_eq!(urlencode("a+b/c"), "a%2Bb%2Fc");
        assert_eq!(urlencode("safe-_.~"), "safe-_.~");
    }

    #[tokio::test]
    async fn send_without_smtp_logs_and_returns() {
        let mailer = Mailer::new(None);
        mailer.send_verification("a@b.com", "http://x").await;
        mailer.send_password_reset("a@b.com", "http://x").await;
        mailer.load().await;
    }
}
