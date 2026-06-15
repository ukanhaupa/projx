package mailer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/smtp"
	"net/url"
	"os"
	"strings"
	"sync"

	"projx.local/go/internal/serviceconfig"
)

const smtpConfigKey = "smtp"

type Config struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"user"`
	Password string `json:"pass"`
	From     string `json:"from"`
	Secure   bool   `json:"secure"`
}

type Mailer struct {
	mu      sync.RWMutex
	cfg     *Config
	loaded  bool
	service *serviceconfig.Service
}

func New(svc *serviceconfig.Service) *Mailer {
	return &Mailer{service: svc}
}

func (m *Mailer) Load(ctx context.Context) error {
	if m.service == nil {
		m.mu.Lock()
		m.loaded = true
		m.mu.Unlock()
		return nil
	}
	plaintext, err := m.service.Get(ctx, smtpConfigKey)
	if err != nil {
		m.mu.Lock()
		m.loaded = true
		m.cfg = nil
		m.mu.Unlock()
		slog.Warn("[mailer] no SMTP config in service_configs — emails will be logged")
		return nil
	}
	var cfg Config
	if err := json.Unmarshal([]byte(plaintext), &cfg); err != nil {
		return fmt.Errorf("smtp config decode: %w", err)
	}
	if cfg.Host == "" {
		slog.Warn("[mailer] SMTP config present but host empty — emails will be logged")
		m.mu.Lock()
		m.cfg = nil
		m.loaded = true
		m.mu.Unlock()
		return nil
	}
	m.mu.Lock()
	m.cfg = &cfg
	m.loaded = true
	m.mu.Unlock()
	return nil
}

func (m *Mailer) snapshot() (*Config, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cfg, m.loaded
}

func frontendURL() string {
	v := strings.TrimSpace(os.Getenv("FRONTEND_URL"))
	if v == "" {
		return "http://localhost:5173"
	}
	return strings.TrimRight(v, "/")
}

func BuildResetLink(token string) string {
	return buildLink("/reset-password", token)
}

func BuildVerificationLink(token string) string {
	return buildLink("/verify-email", token)
}

func buildLink(path, token string) string {
	q := url.Values{}
	q.Set("token", token)
	return frontendURL() + path + "?" + q.Encode()
}

func defaultFrom() string {
	parsed, err := url.Parse(frontendURL())
	host := "localhost"
	if err == nil && parsed.Hostname() != "" {
		host = parsed.Hostname()
	}
	return "noreply@" + host
}

func (m *Mailer) SendPasswordReset(to, link string) error {
	subject := "Reset your password"
	body := fmt.Sprintf("Reset your password using this link (expires in 30 minutes):\n\n%s\n\nIf you didn't request this, ignore this email.", link)
	return m.send(to, subject, body)
}

func (m *Mailer) SendVerification(to, link string) error {
	subject := "Verify your email"
	body := fmt.Sprintf("Confirm your email by visiting this link (expires in 24 hours):\n\n%s\n\nIf you didn't create this account, ignore this email.", link)
	return m.send(to, subject, body)
}

func (m *Mailer) send(to, subject, body string) error {
	cfg, loaded := m.snapshot()
	if !loaded {
		return errors.New("mailer not initialized")
	}
	if cfg == nil {
		slog.Info("[mailer:dev] email logged", "to", to, "subject", subject)
		return nil
	}
	from := cfg.From
	if from == "" {
		from = defaultFrom()
	}
	msg := []byte("From: " + from + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
		body + "\r\n")
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	var auth smtp.Auth
	if cfg.Username != "" && cfg.Password != "" {
		auth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	}
	if err := smtp.SendMail(addr, auth, from, []string{to}, msg); err != nil {
		slog.Error("[mailer] send failed", "to", to, "subject", subject, "err", err)
		return err
	}
	slog.Info("[mailer] sent", "to", to, "subject", subject)
	return nil
}
