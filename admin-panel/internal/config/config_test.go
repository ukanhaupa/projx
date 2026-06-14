package config

import (
	"encoding/base64"
	"testing"
)

func TestNormalizeBasePath(t *testing.T) {
	cases := map[string]string{
		"":        "",
		"/":       "",
		"/admin":  "/admin",
		"/admin/": "/admin",
		"admin":   "/admin",
		"/a/b/":   "/a/b",
	}
	for in, want := range cases {
		if got := normalizeBasePath(in); got != want {
			t.Errorf("normalizeBasePath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLoadRequiresDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SESSION_SECRET", "0123456789012345678901234567890123")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when DATABASE_URL is unset")
	}
}

func TestLoadRequiresSecretLength(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/x")
	t.Setenv("SESSION_SECRET", "tooshort")
	if _, err := Load(); err == nil {
		t.Fatal("expected error for short SESSION_SECRET")
	}
}

func TestLoadDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/x")
	t.Setenv("SESSION_SECRET", "0123456789012345678901234567890123")
	t.Setenv("BASE_PATH", "")
	t.Setenv("PORT", "")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != "8055" {
		t.Errorf("default Port = %q, want 8055", cfg.Port)
	}
	if cfg.BasePath != "/admin" {
		t.Errorf("default BasePath = %q, want /admin", cfg.BasePath)
	}
	if cfg.CredEncryptionKey != nil {
		t.Errorf("CredEncryptionKey should be nil when unset, got %d bytes", len(cfg.CredEncryptionKey))
	}
}

func TestLoadCredEncryptionKey(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/x")
	t.Setenv("SESSION_SECRET", "0123456789012345678901234567890123")
	t.Setenv("CRED_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.CredEncryptionKey) != 32 {
		t.Fatalf("CredEncryptionKey = %d bytes, want 32", len(cfg.CredEncryptionKey))
	}
}

func TestLoadRejectsBadCredEncryptionKey(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/x")
	t.Setenv("SESSION_SECRET", "0123456789012345678901234567890123")
	t.Setenv("CRED_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 16)))
	if _, err := Load(); err == nil {
		t.Fatal("expected error for a CRED_ENCRYPTION_KEY that does not decode to 32 bytes")
	}
}
