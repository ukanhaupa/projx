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
	BrowseSchema   string
	SessionSecret  string
	BootstrapEmail string
	BootstrapPass  string
	WriteTables    []string
}

var reservedSchemas = map[string]bool{
	"admin_panel":        true,
	"pg_catalog":         true,
	"information_schema": true,
	"pg_toast":           true,
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

	browseSchema := envOr("BROWSE_SCHEMA", "public")
	if reservedSchemas[browseSchema] {
		return nil, fmt.Errorf("BROWSE_SCHEMA cannot be a reserved schema (%s)", browseSchema)
	}

	c := &Config{
		DatabaseURL:    dbURL,
		Port:           envOr("PORT", "8055"),
		BasePath:       normalizeBasePath(envOr("BASE_PATH", "/admin")),
		BrowseSchema:   browseSchema,
		SessionSecret:  secret,
		BootstrapEmail: os.Getenv("ADMIN_EMAIL"),
		BootstrapPass:  os.Getenv("ADMIN_PASSWORD"),
		WriteTables:    splitList(os.Getenv("WRITE_TABLES")),
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

func splitList(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
