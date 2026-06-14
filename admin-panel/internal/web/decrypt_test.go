package web

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"adminpanel/internal/auth"
)

func credTestKey(t *testing.T) []byte {
	t.Helper()
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		t.Fatalf("key: %v", err)
	}
	return key
}

func encryptForTest(t *testing.T, key []byte, plaintext string) string {
	t.Helper()
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	iv := make([]byte, 12)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		t.Fatalf("iv: %v", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 12)
	if err != nil {
		t.Fatalf("gcm: %v", err)
	}
	sealed := gcm.Seal(nil, iv, []byte(plaintext), nil)
	ct := sealed[:len(sealed)-16]
	tag := sealed[len(sealed)-16:]
	payload := append(append(append([]byte{}, iv...), tag...), ct...)
	return base64.StdEncoding.EncodeToString(payload)
}

func seedServiceConfigs(t *testing.T, pool *pgxpool.Pool, encrypted string) {
	t.Helper()
	ctx := context.Background()
	for _, stmt := range []string{
		`DROP TABLE IF EXISTS public.service_configs`,
		`CREATE TABLE public.service_configs (
			id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			purpose TEXT NOT NULL,
			config TEXT NOT NULL
		)`,
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("seed service_configs %q: %v", stmt, err)
		}
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO public.service_configs (purpose, config) VALUES ('smtp', $1)`,
		encrypted); err != nil {
		t.Fatalf("insert service_config: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DROP TABLE IF EXISTS public.service_configs`)
	})
}

func serviceConfigID(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id int64
	if err := pool.QueryRow(context.Background(),
		`SELECT id FROM public.service_configs WHERE purpose='smtp'`).Scan(&id); err != nil {
		t.Fatalf("fetch service_config id: %v", err)
	}
	return strconv.FormatInt(id, 10)
}

func serverWithCred(t *testing.T, pool *pgxpool.Pool, key []byte) *Server {
	t.Helper()
	srv := newTestServer(t, pool)
	srv.SetCredKey(key)
	return srv
}

func TestEncryptedConfigMaskedByDefault(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, "smtp-secret-value"))
	srv := serverWithCred(t, pool, key)
	h := srv.Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)

	rec := authedGet(h, "/admin/tables/service_configs", token)
	if rec.Code != http.StatusOK {
		t.Fatalf("explorer should be 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, "smtp-secret-value") {
		t.Fatal("plaintext must never appear on page load")
	}
	if !strings.Contains(body, "encrypted") {
		t.Fatalf("encrypted config cell should render masked; body=%s", body)
	}
}

func TestWriteAdminSeesDecryptAction(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, "x"))
	h := serverWithCred(t, pool, key).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)

	body := authedGet(h, "/admin/tables/service_configs", token).Body.String()
	if !strings.Contains(body, "/decrypt?col=config") {
		t.Fatalf("write admin should see a Decrypt action for the config column; body=%s", body)
	}
}

func TestReadModeAdminSeesNoDecryptAction(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, "x"))
	h := serverWithCred(t, pool, key).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")

	body := authedGet(h, "/admin/tables/service_configs", token).Body.String()
	if strings.Contains(body, "/decrypt?col=config") {
		t.Fatal("read-mode admin must not see a Decrypt action")
	}
}

func TestWriteAdminDecryptReturnsPlaintext(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, "smtp-secret-value"))
	h := serverWithCred(t, pool, key).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)
	id := serviceConfigID(t, pool)

	rec := authedGet(h, "/admin/tables/service_configs/"+id+"/decrypt?col=config", token)
	if rec.Code != http.StatusOK {
		t.Fatalf("decrypt should be 200 for write admin, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "smtp-secret-value") {
		t.Fatalf("decrypt response should reveal plaintext; body=%s", rec.Body.String())
	}
	cc := rec.Header().Get("Cache-Control")
	if !strings.Contains(cc, "no-store") {
		t.Fatalf("decrypt response must set no-store; Cache-Control=%q", cc)
	}
}

func TestReadOnlyAdminDecryptForbidden(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, "smtp-secret-value"))
	h := serverWithCred(t, pool, key).Handler()
	seedAdmin(t, pool, "second@example.com", "other", auth.RoleReadOnly)
	token := loginFull(t, h, "second@example.com", "other")
	id := serviceConfigID(t, pool)

	rec := authedGet(h, "/admin/tables/service_configs/"+id+"/decrypt?col=config", token)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("read-only admin decrypt must be 403, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "smtp-secret-value") {
		t.Fatal("read-only admin must never receive plaintext")
	}
}

func TestReadModeWriteAdminDecryptForbidden(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, "smtp-secret-value"))
	h := serverWithCred(t, pool, key).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	id := serviceConfigID(t, pool)

	rec := authedGet(h, "/admin/tables/service_configs/"+id+"/decrypt?col=config", token)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("decrypt without write mode must be 403, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "smtp-secret-value") {
		t.Fatal("a session not in write mode must never receive plaintext")
	}
}

func TestDecryptGarbageCiphertextGraceful(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, "not-a-valid-ciphertext")
	h := serverWithCred(t, pool, key).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)
	id := serviceConfigID(t, pool)

	rec := authedGet(h, "/admin/tables/service_configs/"+id+"/decrypt?col=config", token)
	if rec.Code == http.StatusOK {
		t.Fatalf("garbage ciphertext should not return 200 with plaintext")
	}
	if rec.Code >= 500 {
		t.Fatalf("garbage ciphertext should be handled gracefully, got %d", rec.Code)
	}
}

func TestDecryptUnavailableWhenKeyNotConfigured(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, "smtp-secret-value"))
	h := newTestServer(t, pool).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)
	id := serviceConfigID(t, pool)

	body := authedGet(h, "/admin/tables/service_configs", token).Body.String()
	if strings.Contains(body, "/decrypt?col=config") {
		t.Fatal("no Decrypt action should render when CRED_ENCRYPTION_KEY is unconfigured")
	}

	rec := authedGet(h, "/admin/tables/service_configs/"+id+"/decrypt?col=config", token)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("decrypt without a configured key should be a clear 503, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "not configured") {
		t.Fatalf("response should explain decryption is unavailable; body=%s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "smtp-secret-value") {
		t.Fatal("plaintext must never leak when no key is configured")
	}
}

func TestDecryptScopedToServiceConfigsOnly(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, "x"))
	h := serverWithCred(t, pool, key).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)

	body := authedGet(h, "/admin/tables/widgets", token).Body.String()
	if strings.Contains(body, "/decrypt?col=") {
		t.Fatal("non-service_configs tables must not render a Decrypt action")
	}

	rec := authedGet(h, "/admin/tables/widgets/1/decrypt?col=name", token)
	if rec.Code == http.StatusOK {
		t.Fatalf("decrypt on a non-encrypted column must not return 200, got %d", rec.Code)
	}
}

func TestDecryptNeverLogsPlaintext(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, "audit-must-not-leak"))
	srv := serverWithCred(t, pool, key)
	h := srv.Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)
	id := serviceConfigID(t, pool)

	authedGet(h, "/admin/tables/service_configs/"+id+"/decrypt?col=config", token)

	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM admin_panel.write_audit_log
		 WHERE new_value::text LIKE '%audit-must-not-leak%'
		    OR old_value::text LIKE '%audit-must-not-leak%'`).Scan(&count); err != nil {
		t.Fatalf("audit query: %v", err)
	}
	if count != 0 {
		t.Fatal("plaintext must never be written to the audit log")
	}
}
