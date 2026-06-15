package mailer

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/smtp"
	"net/url"
	"os"
	"strings"
	"sync"
)

type SMTPConfig struct {
	Host   string `json:"host"`
	Port   int    `json:"port"`
	Secure bool   `json:"secure"`
	User   string `json:"user"`
	Pass   string `json:"pass"`
	From   string `json:"from"`
}

type ConfigProvider interface {
	GetConfig(ctx context.Context, key string) (map[string]any, error)
}

type Mailer struct {
	mu     sync.RWMutex
	cfg    *SMTPConfig
	warned bool
	logger *slog.Logger
}

func New(logger *slog.Logger) *Mailer {
	if logger == nil {
		logger = slog.Default()
	}
	return &Mailer{logger: logger}
}

func (m *Mailer) Init(ctx context.Context, provider ConfigProvider) {
	if provider == nil {
		return
	}
	raw, err := provider.GetConfig(ctx, "smtp")
	if err != nil {
		m.logger.Warn("[mailer] no SMTP configured in service_configs - emails will be logged")
		return
	}
	buf, err := json.Marshal(raw)
	if err != nil {
		m.logger.Warn("[mailer] invalid SMTP config payload", "error", err.Error())
		return
	}
	cfg := &SMTPConfig{Port: 587}
	if err := json.Unmarshal(buf, cfg); err != nil || cfg.Host == "" {
		m.logger.Warn("[mailer] invalid SMTP config")
		return
	}
	m.mu.Lock()
	m.cfg = cfg
	m.mu.Unlock()
	m.logger.Info("[mailer] SMTP configured", "host", cfg.Host)
}

func (m *Mailer) config() *SMTPConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cfg
}

func frontendURL() string {
	v := strings.TrimSpace(os.Getenv("FRONTEND_URL"))
	if v == "" {
		return "http://localhost:5173"
	}
	return v
}

func (m *Mailer) from() string {
	cfg := m.config()
	if cfg != nil && cfg.From != "" {
		return cfg.From
	}
	u, err := url.Parse(frontendURL())
	if err != nil || u.Host == "" {
		return "noreply@localhost"
	}
	host := u.Hostname()
	return "noreply@" + host
}

func BuildResetLink(token string) string {
	base := strings.TrimRight(frontendURL(), "/")
	u, err := url.Parse(base + "/reset-password")
	if err != nil {
		return base + "/reset-password?token=" + url.QueryEscape(token) // pragma: allowlist secret
	}
	q := u.Query()
	q.Set("token", token)
	u.RawQuery = q.Encode()
	return u.String()
}

func BuildVerificationLink(token string) string {
	base := strings.TrimRight(frontendURL(), "/")
	u, err := url.Parse(base + "/verify-email")
	if err != nil {
		return base + "/verify-email?token=" + url.QueryEscape(token) // pragma: allowlist secret
	}
	q := u.Query()
	q.Set("token", token)
	u.RawQuery = q.Encode()
	return u.String()
}

func escapeHTML(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
	)
	return r.Replace(s)
}

func renderHTML(title, message, actionLabel, actionURL string) string {
	return fmt.Sprintf(`<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:24px auto;padding:24px;color:#222;">
  <h2 style="margin-top:0;">%s</h2>
  <p>%s</p>
  <p><a href="%s" style="display:inline-block;padding:10px 20px;background:#0a66c2;color:#fff;text-decoration:none;border-radius:4px;">%s</a></p>
  <p style="font-size:12px;color:#888;margin-top:24px;">If the button doesn't work, paste this link: %s</p>
</body></html>`,
		escapeHTML(title), escapeHTML(message), escapeHTML(actionURL), escapeHTML(actionLabel), escapeHTML(actionURL))
}

func (m *Mailer) send(to, subject, text, html string) error {
	cfg := m.config()
	if cfg == nil {
		m.mu.Lock()
		warned := m.warned
		m.warned = true
		m.mu.Unlock()
		if !warned {
			m.logger.Warn("[mailer] transporter not initialized - call Init() at startup")
		}
		m.logger.Info("[mailer:dev] queued", "to", to, "subject", subject)
		return nil
	}
	body := buildMessage(m.from(), to, subject, text, html)
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	var auth smtp.Auth
	if cfg.User != "" && cfg.Pass != "" {
		auth = smtp.PlainAuth("", cfg.User, cfg.Pass, cfg.Host)
	}
	if err := smtp.SendMail(addr, auth, m.from(), []string{to}, []byte(body)); err != nil {
		m.logger.Error("[mailer] send failed", "to", to, "subject", subject, "error", err.Error())
		return err
	}
	m.logger.Info("[mailer] sent", "to", to, "subject", subject)
	return nil
}

func buildMessage(from, to, subject, text, html string) string {
	boundary := "projx-mailer-boundary"
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", to)
	fmt.Fprintf(&b, "Subject: %s\r\n", subject)
	fmt.Fprintf(&b, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&b, "Content-Type: multipart/alternative; boundary=%s\r\n\r\n", boundary)
	fmt.Fprintf(&b, "--%s\r\nContent-Type: text/plain; charset=\"utf-8\"\r\n\r\n%s\r\n", boundary, text)
	fmt.Fprintf(&b, "--%s\r\nContent-Type: text/html; charset=\"utf-8\"\r\n\r\n%s\r\n", boundary, html)
	fmt.Fprintf(&b, "--%s--\r\n", boundary)
	return b.String()
}

func (m *Mailer) SendPasswordReset(to, resetLink string) error {
	subject := "Reset your password"
	text := fmt.Sprintf("Reset your password using this link (expires in 30 minutes):\n\n%s\n\nIf you didn't request this, ignore this email.", resetLink)
	html := renderHTML(
		"Reset your password",
		"Click the button below to set a new password. This link expires in 30 minutes. If you didn't request this, ignore this email.",
		"Reset password",
		resetLink,
	)
	return m.send(to, subject, text, html)
}

func (m *Mailer) SendVerification(to, verificationLink string) error {
	subject := "Verify your email"
	text := fmt.Sprintf("Confirm your email by visiting this link (expires in 24 hours):\n\n%s\n\nIf you didn't create this account, ignore this email.", verificationLink)
	html := renderHTML(
		"Verify your email",
		"Click the button below to confirm your email address. This link expires in 24 hours. If you didn't create this account, ignore this email.",
		"Verify email",
		verificationLink,
	)
	return m.send(to, subject, text, html)
}
