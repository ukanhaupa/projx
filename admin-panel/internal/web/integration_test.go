package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"adminpanel/internal/auth"
	"adminpanel/internal/browser"
	"adminpanel/internal/db"
	"adminpanel/internal/testenv"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := testenv.DatabaseURL()
	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	for _, stmt := range []string{
		`DROP SCHEMA IF EXISTS admin_panel CASCADE`,
		`DROP TABLE IF EXISTS public.widgets`,
		`DROP TABLE IF EXISTS public.audit_only`,
		`CREATE TABLE public.widgets (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL, qty INT)`,
		`INSERT INTO public.widgets (name, qty) VALUES ('alpha', 1), ('beta', 2)`,
		`CREATE TABLE public.audit_only (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, note TEXT)`,
		`INSERT INTO public.audit_only (note) VALUES ('locked')`,
		`DROP TABLE IF EXISTS public.mixed`,
		`CREATE TABLE public.mixed (
			id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			label TEXT,
			active BOOLEAN,
			score NUMERIC,
			meta JSONB,
			seen_at TIMESTAMPTZ
		)`,
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("seed %q: %v", stmt, err)
		}
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DROP SCHEMA IF EXISTS admin_panel CASCADE`)
		_, _ = pool.Exec(c, `DROP TABLE IF EXISTS public.widgets`)
		_, _ = pool.Exec(c, `DROP TABLE IF EXISTS public.audit_only`)
		_, _ = pool.Exec(c, `DROP TABLE IF EXISTS public.mixed`)
	})
	return pool
}

func newTestServer(t *testing.T, pool *pgxpool.Pool, writeTables []string) *Server {
	t.Helper()
	ctx := context.Background()
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate is not idempotent: %v", err)
	}
	store := auth.NewStore(pool)
	if err := store.EnsureBootstrap(ctx, "admin@example.com", "s3cret-pass"); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if err := store.EnsureBootstrap(ctx, "second@example.com", "other"); err != nil {
		t.Fatalf("bootstrap second: %v", err)
	}
	srv, err := NewServer("/admin", store,
		browser.NewSchema(pool, "public"), browser.NewRepo(pool), browser.NewPerms(writeTables))
	if err != nil {
		t.Fatalf("server: %v", err)
	}
	return srv
}

func login(t *testing.T, h http.Handler, email, password string) string {
	t.Helper()
	form := url.Values{"email": {email}, "password": {password}}
	req := httptest.NewRequest(http.MethodPost, "/admin/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookie {
			return c.Value
		}
	}
	return ""
}

func authedGet(h http.Handler, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func authedPost(h http.Handler, path, token string, form url.Values) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if token != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestBootstrapOnlySeedsFirstAdmin(t *testing.T) {
	pool := testPool(t)
	newTestServer(t, pool, nil)
	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM admin_panel.admin_users`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 admin after two bootstraps, got %d", count)
	}
}

func TestLoginAndProtectedRedirect(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool, nil).Handler()

	if rec := authedGet(h, "/admin/", ""); rec.Code != http.StatusSeeOther {
		t.Fatalf("unauthenticated should redirect, got %d", rec.Code)
	}
	if login(t, h, "admin@example.com", "wrong") != "" {
		t.Fatal("wrong password should not yield a session")
	}
	token := login(t, h, "admin@example.com", "s3cret-pass")
	if token == "" {
		t.Fatal("valid login should set a session cookie")
	}
	if rec := authedGet(h, "/admin/", token); rec.Code != http.StatusOK {
		t.Fatalf("authenticated index should be 200, got %d", rec.Code)
	}
}

func TestUnknownTableIs404(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool, nil).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	for _, name := range []string{"does_not_exist", "widgets; DROP TABLE widgets", "pg_class"} {
		rec := authedGet(h, "/admin/tables/"+url.PathEscape(name), token)
		if rec.Code != http.StatusNotFound {
			t.Errorf("table %q should be 404, got %d", name, rec.Code)
		}
	}
}

func TestBrowseListsRows(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool, nil).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	rec := authedGet(h, "/admin/tables/widgets", token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "alpha") || !strings.Contains(body, "beta") {
		t.Fatal("expected seeded rows in the explorer body")
	}
	if !strings.Contains(body, "read-only") {
		t.Fatal("expected read-only badge when table not in write allowlist")
	}
}

func TestReadOnlyTableRejectsWrites(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool, []string{"widgets"}).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	rec := authedPost(h, "/admin/tables/audit_only/1", token, url.Values{"note": {"hacked"}})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("write to non-allowlisted table should be 403, got %d", rec.Code)
	}
}

func TestWritableTableCRUD(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool, []string{"widgets"}).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")
	ctx := context.Background()

	create := authedPost(h, "/admin/tables/widgets/new", token, url.Values{"name": {"gamma"}, "qty": {"9"}})
	if create.Code != http.StatusSeeOther {
		t.Fatalf("create should redirect, got %d", create.Code)
	}
	var qty int
	if err := pool.QueryRow(ctx, `SELECT qty FROM public.widgets WHERE name='gamma'`).Scan(&qty); err != nil {
		t.Fatalf("created row not found: %v", err)
	}
	if qty != 9 {
		t.Fatalf("expected qty 9, got %d", qty)
	}

	var id int64
	_ = pool.QueryRow(ctx, `SELECT id FROM public.widgets WHERE name='gamma'`).Scan(&id)
	update := authedPost(h, "/admin/tables/widgets/"+strconv.FormatInt(id, 10), token, url.Values{"name": {"gamma2"}, "qty": {"10"}})
	if update.Code != http.StatusSeeOther {
		t.Fatalf("update should redirect, got %d", update.Code)
	}
	var name string
	_ = pool.QueryRow(ctx, `SELECT name FROM public.widgets WHERE id=$1`, id).Scan(&name)
	if name != "gamma2" {
		t.Fatalf("expected name gamma2, got %q", name)
	}

	del := authedPost(h, "/admin/tables/widgets/"+strconv.FormatInt(id, 10)+"/delete", token, nil)
	if del.Code != http.StatusSeeOther {
		t.Fatalf("delete should redirect, got %d", del.Code)
	}
	var remaining int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM public.widgets WHERE id=$1`, id).Scan(&remaining)
	if remaining != 0 {
		t.Fatal("row should be deleted")
	}
}

func TestMixedTypesRoundTrip(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool, []string{"mixed"}).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")
	ctx := context.Background()

	form := url.Values{
		"label":   {"hello"},
		"active":  {"false", "true"},
		"score":   {"3.5"},
		"meta":    {`{"k":"v"}`},
		"seen_at": {"2026-06-08T10:30:00Z"},
	}
	if rec := authedPost(h, "/admin/tables/mixed/new", token, form); rec.Code != http.StatusSeeOther {
		t.Fatalf("create should redirect, got %d: %s", rec.Code, rec.Body.String())
	}

	var (
		label  string
		active bool
		score  float64
		meta   string
	)
	err := pool.QueryRow(ctx,
		`SELECT label, active, score, meta::text FROM public.mixed WHERE label='hello'`,
	).Scan(&label, &active, &score, &meta)
	if err != nil {
		t.Fatalf("row not persisted with correct types: %v", err)
	}
	if !active {
		t.Error("bool not coerced: active should be true")
	}
	if score != 3.5 {
		t.Errorf("numeric not coerced: score = %v, want 3.5", score)
	}
	if !strings.Contains(meta, `"k": "v"`) && !strings.Contains(meta, `"k":"v"`) {
		t.Errorf("jsonb not stored: %q", meta)
	}
}

func TestInvalidJSONRejected(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool, []string{"mixed"}).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	form := url.Values{"label": {"bad"}, "meta": {"{not json}"}}
	rec := authedPost(h, "/admin/tables/mixed/new", token, form)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid JSON should be 400, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "valid JSON") {
		t.Error("expected a JSON validation message in the response")
	}
}

func TestLogoutClearsSession(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool, nil).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	if rec := authedPost(h, "/admin/logout", token, nil); rec.Code != http.StatusSeeOther {
		t.Fatalf("logout should redirect, got %d", rec.Code)
	}
	if rec := authedGet(h, "/admin/", token); rec.Code != http.StatusSeeOther {
		t.Fatal("session should be invalid after logout")
	}
}

func TestLoginFormRenders(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool, nil).Handler()
	rec := authedGet(h, "/admin/login", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("login form should be 200, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Sign in") {
		t.Error("expected the sign-in form")
	}
}

func TestNewAndEditForms(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool, []string{"mixed"}).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	newForm := authedGet(h, "/admin/tables/mixed/new", token)
	if newForm.Code != http.StatusOK {
		t.Fatalf("new-row form should be 200, got %d", newForm.Code)
	}
	body := newForm.Body.String()
	if !strings.Contains(body, `type="checkbox"`) {
		t.Error("expected a checkbox widget for the bool column")
	}
	if !strings.Contains(body, "<textarea") {
		t.Error("expected a textarea widget for the jsonb column")
	}

	create := authedPost(h, "/admin/tables/mixed/new", token, url.Values{"label": {"editme"}})
	if create.Code != http.StatusSeeOther {
		t.Fatalf("create failed: %d", create.Code)
	}
	var id int64
	_ = pool.QueryRow(context.Background(), `SELECT id FROM public.mixed WHERE label='editme'`).Scan(&id)

	editForm := authedGet(h, "/admin/tables/mixed/"+strconv.FormatInt(id, 10), token)
	if editForm.Code != http.StatusOK {
		t.Fatalf("edit form should be 200, got %d", editForm.Code)
	}
	if !strings.Contains(editForm.Body.String(), "editme") {
		t.Error("edit form should prefill the row value")
	}

	missing := authedGet(h, "/admin/tables/mixed/999999", token)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("edit form for missing id should be 404, got %d", missing.Code)
	}
}

func TestHealthz(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool, nil).Handler()
	if rec := authedGet(h, "/admin/healthz", ""); rec.Code != http.StatusOK {
		t.Fatalf("healthz should be 200 without auth, got %d", rec.Code)
	}
}
