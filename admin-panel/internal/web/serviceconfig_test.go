package web

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"adminpanel/internal/auth"
	"adminpanel/internal/secret"
)

func TestPairsToJSONTypes(t *testing.T) {
	got, err := pairsToJSON([]kvPair{
		{Key: "host", Value: "smtp.example.com"},
		{Key: "port", Value: "587"},
		{Key: "secure", Value: "true"},
		{Key: "opts", Value: `{"x":1}`},
		{Key: "", Value: "skip-blank-key"},
	})
	if err != nil {
		t.Fatalf("pairsToJSON: %v", err)
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(got), &obj); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if obj["host"] != "smtp.example.com" {
		t.Errorf("host = %v, want string", obj["host"])
	}
	if obj["port"] != float64(587) {
		t.Errorf("port = %v (%T), want number 587", obj["port"], obj["port"])
	}
	if obj["secure"] != true {
		t.Errorf("secure = %v, want bool true", obj["secure"])
	}
	if m, ok := obj["opts"].(map[string]any); !ok || m["x"] != float64(1) {
		t.Errorf("opts = %v, want nested object", obj["opts"])
	}
	if _, exists := obj[""]; exists {
		t.Error("blank key must be skipped")
	}
}

func TestPairsRoundTripIsLossless(t *testing.T) {
	original := `{"enabled":true,"host":"a.b","nested":{"k":"v"},"password":"12345678","port":587}`
	pairs, err := jsonToPairs(original)
	if err != nil {
		t.Fatalf("jsonToPairs: %v", err)
	}
	encoded, err := pairsToJSON(pairs)
	if err != nil {
		t.Fatalf("pairsToJSON: %v", err)
	}
	var a, b map[string]any
	_ = json.Unmarshal([]byte(original), &a)
	_ = json.Unmarshal([]byte(encoded), &b)
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("round trip changed types:\n orig = %s\n got  = %s", original, encoded)
	}
}

func seedServiceConfigsFull(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	for _, stmt := range []string{
		`DROP TABLE IF EXISTS public.service_configs`,
		`CREATE TABLE public.service_configs (
			id TEXT PRIMARY KEY,
			purpose TEXT NOT NULL UNIQUE,
			config TEXT NOT NULL,
			is_active BOOLEAN NOT NULL DEFAULT true,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL
		)`,
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("seed service_configs %q: %v", stmt, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DROP TABLE IF EXISTS public.service_configs`)
	})
}

func decryptedConfig(t *testing.T, pool *pgxpool.Pool, key []byte, id string) string {
	t.Helper()
	var enc string
	if err := pool.QueryRow(context.Background(),
		`SELECT config FROM public.service_configs WHERE id::text = $1`, id).Scan(&enc); err != nil {
		t.Fatalf("read config: %v", err)
	}
	plain, err := secret.Decrypt(enc, key)
	if err != nil {
		t.Fatalf("decrypt saved config: %v", err)
	}
	return plain
}

func TestServiceConfigEditFormShowsDecryptedPairs(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, `{"host":"smtp.example.com","port":587}`))
	h := serverWithCred(t, pool, key).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)
	id := serviceConfigID(t, pool)

	rec := authedGet(h, "/admin/service-config/"+id, token)
	if rec.Code != http.StatusOK {
		t.Fatalf("edit form should be 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, want := range []string{"host", "smtp.example.com", "port", "587", "kv_key", "kv_value"} {
		if !strings.Contains(body, want) {
			t.Fatalf("edit form should contain %q; body=%s", want, body)
		}
	}
}

func TestServiceConfigSaveEncryptsRoundTrip(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, `{"host":"old"}`))
	h := serverWithCred(t, pool, key).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)
	id := serviceConfigID(t, pool)

	form := url.Values{}
	form.Add("kv_key", "host")
	form.Add("kv_value", "smtp.new.example.com")
	form.Add("kv_key", "port")
	form.Add("kv_value", "2525")
	rec := authedPost(h, "/admin/service-config/"+id, token, form)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("save should redirect (303), got %d: %s", rec.Code, rec.Body.String())
	}

	got := decryptedConfig(t, pool, key, id)
	var obj map[string]any
	if err := json.Unmarshal([]byte(got), &obj); err != nil {
		t.Fatalf("saved config is not JSON: %q", got)
	}
	if obj["host"] != "smtp.new.example.com" {
		t.Errorf("host = %v", obj["host"])
	}
	if obj["port"] != float64(2525) {
		t.Errorf("port = %v (%T), want number 2525", obj["port"], obj["port"])
	}
}

func TestServiceConfigReadModeForbidden(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, `{"host":"x"}`))
	h := serverWithCred(t, pool, key).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	id := serviceConfigID(t, pool)

	if rec := authedGet(h, "/admin/service-config/"+id, token); rec.Code != http.StatusForbidden {
		t.Fatalf("edit form without write mode must be 403, got %d", rec.Code)
	}
	form := url.Values{"kv_key": {"host"}, "kv_value": {"leak"}}
	if rec := authedPost(h, "/admin/service-config/"+id, token, form); rec.Code != http.StatusForbidden {
		t.Fatalf("save without write mode must be 403, got %d", rec.Code)
	}
}

func TestServiceConfigUnavailableWhenKeyNotConfigured(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, `{"host":"x"}`))
	h := newTestServer(t, pool).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)
	id := serviceConfigID(t, pool)

	if rec := authedGet(h, "/admin/service-config/"+id, token); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("edit form without a configured key must be 503, got %d", rec.Code)
	}
}

func TestServiceConfigListShowsPurposes(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, `{"host":"x"}`))
	h := serverWithCred(t, pool, key).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)

	rec := authedGet(h, "/admin/service-config", token)
	if rec.Code != http.StatusOK {
		t.Fatalf("list should be 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "smtp") {
		t.Fatalf("list should show the smtp purpose; body=%s", body)
	}
	if !strings.Contains(body, "/service-config/new") {
		t.Fatalf("write admin should see a New config action; body=%s", body)
	}
}

func TestServiceConfigListReadOnlyHidesEdit(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, `{"host":"x"}`))
	h := serverWithCred(t, pool, key).Handler()
	seedAdmin(t, pool, "ro@example.com", "ro-pass-123", auth.RoleReadOnly)
	token := loginFull(t, h, "ro@example.com", "ro-pass-123")

	body := authedGet(h, "/admin/service-config", token).Body.String()
	if strings.Contains(body, "/service-config/new") {
		t.Fatal("read-only admin must not see the New config action")
	}
	id := serviceConfigID(t, pool)
	if rec := authedGet(h, "/admin/service-config/"+id, token); rec.Code != http.StatusForbidden {
		t.Fatalf("read-only admin edit form must be 403, got %d", rec.Code)
	}
}

func TestServiceConfigCreateGeneratesUUIDAndTimestamps(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigsFull(t, pool)
	h := serverWithCred(t, pool, key).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)

	form := url.Values{}
	form.Set("purpose", "jwt")
	form.Add("is_active", "false")
	form.Add("is_active", "true")
	form.Add("kv_key", "secret")
	form.Add("kv_value", "top-secret-value")
	form.Add("kv_key", "ttl")
	form.Add("kv_value", "3600")
	rec := authedPost(h, "/admin/service-config/new", token, form)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("create should redirect (303), got %d: %s", rec.Code, rec.Body.String())
	}

	var (
		id       string
		isActive bool
	)
	if err := pool.QueryRow(context.Background(),
		`SELECT id, is_active FROM public.service_configs WHERE purpose = 'jwt'`).Scan(&id, &isActive); err != nil {
		t.Fatalf("created row not found: %v", err)
	}
	if !isActive {
		t.Error("is_active should be true when the checkbox is checked (last form value wins)")
	}
	if len(id) < 32 || !strings.Contains(id, "-") {
		t.Fatalf("id should be a generated uuid, got %q", id)
	}
	got := decryptedConfig(t, pool, key, id)
	var obj map[string]any
	if err := json.Unmarshal([]byte(got), &obj); err != nil {
		t.Fatalf("saved config is not JSON: %q", got)
	}
	if obj["secret"] != "top-secret-value" {
		t.Errorf("secret = %v", obj["secret"])
	}
	if obj["ttl"] != float64(3600) {
		t.Errorf("ttl = %v (%T), want number 3600", obj["ttl"], obj["ttl"])
	}
}

func TestServiceConfigSaveNeverLogsPlaintext(t *testing.T) {
	pool := testPool(t)
	key := credTestKey(t)
	seedServiceConfigs(t, pool, encryptForTest(t, key, `{"host":"x"}`))
	h := serverWithCred(t, pool, key).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)
	id := serviceConfigID(t, pool)

	form := url.Values{"kv_key": {"password"}, "kv_value": {"plaintext-must-not-leak"}}
	if rec := authedPost(h, "/admin/service-config/"+id, token, form); rec.Code != http.StatusSeeOther {
		t.Fatalf("save should redirect, got %d", rec.Code)
	}

	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM admin_panel.write_audit_log
		 WHERE new_value::text LIKE '%plaintext-must-not-leak%'
		    OR old_value::text LIKE '%plaintext-must-not-leak%'`).Scan(&count); err != nil {
		t.Fatalf("audit query: %v", err)
	}
	if count != 0 {
		t.Fatal("plaintext must never be written to the audit log")
	}
}
