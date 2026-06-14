package config

import (
	"fmt"
	"os"
	"strings"

	"adminpanel/internal/secret"
)

type Config struct {
	DatabaseURL       string
	Port              string
	BasePath          string
	SessionSecret     string
	BootstrapEmail    string
	BootstrapPass     string
	CookieSecure      bool
	CredEncryptionKey []byte
}

func Load() (*Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	sessionSecret := os.Getenv("SESSION_SECRET")
	if sessionSecret == "" {
		return nil, fmt.Errorf("SESSION_SECRET is required (32+ random bytes)")
	}
	if len(sessionSecret) < 32 {
		return nil, fmt.Errorf("SESSION_SECRET must be at least 32 bytes")
	}

	var credKey []byte
	if raw := os.Getenv("CRED_ENCRYPTION_KEY"); raw != "" {
		key, err := secret.ParseKey(raw)
		if err != nil {
			return nil, err
		}
		credKey = key
	}

	c := &Config{
		DatabaseURL:       dbURL,
		Port:              envOr("PORT", "8055"),
		BasePath:          normalizeBasePath(envOr("BASE_PATH", "/admin")),
		SessionSecret:     sessionSecret,
		BootstrapEmail:    os.Getenv("ADMIN_EMAIL"),
		BootstrapPass:     os.Getenv("ADMIN_PASSWORD"),
		CookieSecure:      !strings.EqualFold(os.Getenv("COOKIE_SECURE"), "false"),
		CredEncryptionKey: credKey,
	}
	return c, nil
}

func normalizeBasePath(p string) string {
	if p == "" || p == "/" {
		return ""
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return strings.TrimRight(p, "/")
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
