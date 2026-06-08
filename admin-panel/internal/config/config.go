package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	DatabaseURL    string
	Port           string
	BasePath       string
	SessionSecret  string
	BootstrapEmail string
	BootstrapPass  string
}

func Load() (*Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	secret := os.Getenv("SESSION_SECRET")
	if secret == "" {
		return nil, fmt.Errorf("SESSION_SECRET is required (32+ random bytes)")
	}
	if len(secret) < 32 {
		return nil, fmt.Errorf("SESSION_SECRET must be at least 32 bytes")
	}

	c := &Config{
		DatabaseURL:    dbURL,
		Port:           envOr("PORT", "8055"),
		BasePath:       normalizeBasePath(envOr("BASE_PATH", "/admin")),
		SessionSecret:  secret,
		BootstrapEmail: os.Getenv("ADMIN_EMAIL"),
		BootstrapPass:  os.Getenv("ADMIN_PASSWORD"),
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
