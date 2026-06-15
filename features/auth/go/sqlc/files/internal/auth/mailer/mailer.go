package mailer

import (
	"context"
	"errors"
	"fmt"
	"net/smtp"
	"strings"

	"projx.local/go/internal/auth/service"
)

type Mailer struct {
	secrets *authservice.Secrets
}

func New(secrets *authservice.Secrets) *Mailer {
	return &Mailer{secrets: secrets}
}

func (m *Mailer) FrontendURL(ctx context.Context) (string, error) {
	cfg, err := m.secrets.SMTP(ctx)
	if err != nil {
		return "", err
	}
	if cfg.FrontHost == "" {
		return "", errors.New("frontend URL is not configured")
	}
	return strings.TrimRight(cfg.FrontHost, "/"), nil
}

func (m *Mailer) BuildResetLink(ctx context.Context, token string) (string, error) {
	base, err := m.FrontendURL(ctx)
	if err != nil {
		return "", err
	}
	return base + "/reset-password?token=" + token, nil // pragma: allowlist secret
}

func (m *Mailer) BuildVerificationLink(ctx context.Context, token string) (string, error) {
	base, err := m.FrontendURL(ctx)
	if err != nil {
		return "", err
	}
	return base + "/verify-email?token=" + token, nil // pragma: allowlist secret
}

func (m *Mailer) Send(ctx context.Context, to, subject, body string) error {
	cfg, err := m.secrets.SMTP(ctx)
	if err != nil {
		return err
	}
	if cfg.Host == "" || cfg.Port == 0 {
		return errors.New("smtp not configured")
	}
	from := cfg.FromAddr
	if from == "" {
		from = cfg.Username
	}
	if from == "" {
		return errors.New("smtp from address not configured")
	}
	fromHeader := from
	if cfg.FromName != "" {
		fromHeader = fmt.Sprintf("%s <%s>", cfg.FromName, from)
	}
	msg := []byte("From: " + fromHeader + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
		body + "\r\n")
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	var auth smtp.Auth
	if cfg.Username != "" {
		auth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	}
	return smtp.SendMail(addr, auth, from, []string{to}, msg)
}

func (m *Mailer) SendPasswordReset(ctx context.Context, to, link string) error {
	return m.Send(ctx, to, "Reset your password",
		"A password reset was requested for your account. Click the link below to reset your password.\n\n"+link+"\n\nIf you did not request this, you can ignore this email.")
}

func (m *Mailer) SendVerification(ctx context.Context, to, link string) error {
	return m.Send(ctx, to, "Verify your email",
		"Welcome! Verify your email address by clicking the link below.\n\n"+link+"\n\nThis link expires in 24 hours.")
}
