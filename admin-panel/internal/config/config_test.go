package config

import "testing"

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

func TestSplitList(t *testing.T) {
	got := splitList(" users, posts ,, orders ")
	want := []string{"users", "posts", "orders"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
	if splitList("") != nil {
		t.Error("empty string should yield nil")
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

func TestLoadRejectsReservedBrowseSchema(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/x")
	t.Setenv("SESSION_SECRET", "0123456789012345678901234567890123")
	t.Setenv("BROWSE_SCHEMA", "admin_panel")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when BROWSE_SCHEMA is a reserved schema")
	}
}

func TestLoadDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/x")
	t.Setenv("SESSION_SECRET", "0123456789012345678901234567890123")
	t.Setenv("BROWSE_SCHEMA", "")
	t.Setenv("BASE_PATH", "")
	t.Setenv("PORT", "")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.BrowseSchema != "public" {
		t.Errorf("default BrowseSchema = %q, want public", cfg.BrowseSchema)
	}
	if cfg.Port != "8055" {
		t.Errorf("default Port = %q, want 8055", cfg.Port)
	}
	if cfg.BasePath != "/admin" {
		t.Errorf("default BasePath = %q, want /admin", cfg.BasePath)
	}
}
