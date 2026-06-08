package testenv

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

func DatabaseURL() string {
	loadEnvTest()
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		return v
	}
	panic("TEST_DATABASE_URL is not set and admin-panel/.env.test was not found — start Postgres and configure .env.test")
}

func loadEnvTest() {
	dir, err := os.Getwd()
	if err != nil {
		return
	}
	for {
		candidate := filepath.Join(dir, ".env.test")
		if applyEnvFile(candidate) {
			return
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return
		}
		dir = parent
	}
}

func applyEnvFile(path string) bool {
	f, err := os.Open(path) // #nosec G304 -- test-only env loader, paths hard-coded
	if err != nil {
		return false
	}
	defer func() { _ = f.Close() }()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, value)
		}
	}
	return true
}
