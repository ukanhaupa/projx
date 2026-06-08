package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"adminpanel/internal/audit"
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

func newTestServer(t *testing.T, pool *pgxpool.Pool) *Server {
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
		browser.NewSchema(pool), browser.NewRepo(pool), audit.NewLogger(pool))
	if err != nil {
		t.Fatalf("server: %v", err)
	}
	return srv
}

func enableWriteMode(t *testing.T, pool *pgxpool.Pool, token string) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		`UPDATE admin_panel.admin_sessions SET write_mode_until = $2 WHERE token = $1`,
		token, time.Now().Add(15*time.Minute))
	if err != nil {
		t.Fatalf("enable write mode: %v", err)
	}
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
	newTestServer(t, pool)
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
	h := newTestServer(t, pool).Handler()

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
	h := newTestServer(t, pool).Handler()
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
	h := newTestServer(t, pool).Handler()
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
		t.Fatal("expected read-only badge when session is in read mode")
	}
	if !strings.Contains(body, "Read-only — enable write") {
		t.Fatal("expected the read_write admin to see the enable-write toggle")
	}
}

func TestReadModeRejectsWrites(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	for _, path := range []string{
		"/admin/tables/widgets/new",
		"/admin/tables/widgets/1",
		"/admin/tables/widgets/1/delete",
	} {
		rec := authedPost(h, path, token, url.Values{"name": {"hacked"}})
		if rec.Code != http.StatusForbidden {
			t.Errorf("POST %s in read mode should be 403, got %d", path, rec.Code)
		}
	}
}

func TestWritableTableCRUD(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")
	enableWriteMode(t, pool, token)
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
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")
	enableWriteMode(t, pool, token)
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
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")
	enableWriteMode(t, pool, token)

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
	h := newTestServer(t, pool).Handler()
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
	h := newTestServer(t, pool).Handler()
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
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")
	enableWriteMode(t, pool, token)

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
	h := newTestServer(t, pool).Handler()
	if rec := authedGet(h, "/admin/healthz", ""); rec.Code != http.StatusOK {
		t.Fatalf("healthz should be 200 without auth, got %d", rec.Code)
	}
}

func TestModeToggleByReadWriteAdmin(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	on := authedPost(h, "/admin/mode", token, url.Values{"write": {"on"}, "return": {"/admin/tables/widgets"}})
	if on.Code != http.StatusSeeOther {
		t.Fatalf("toggle on should redirect, got %d", on.Code)
	}
	if loc := on.Header().Get("Location"); loc != "/admin/tables/widgets" {
		t.Errorf("expected redirect to /admin/tables/widgets, got %q", loc)
	}
	if rec := authedPost(h, "/admin/tables/widgets/new", token,
		url.Values{"name": {"omega"}, "qty": {"1"}}); rec.Code != http.StatusSeeOther {
		t.Fatalf("write after enabling should succeed, got %d", rec.Code)
	}

	off := authedPost(h, "/admin/mode", token, url.Values{"write": {"off"}, "return": {"/admin/"}})
	if off.Code != http.StatusSeeOther {
		t.Fatalf("toggle off should redirect, got %d", off.Code)
	}
	if rec := authedPost(h, "/admin/tables/widgets/new", token,
		url.Values{"name": {"second"}, "qty": {"2"}}); rec.Code != http.StatusForbidden {
		t.Fatalf("write after disable should be 403, got %d", rec.Code)
	}
}

func TestReadOnlyAdminCannotEnableWriteMode(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	seedAdmin(t, pool, "second@example.com", "other", auth.RoleReadOnly)
	token := login(t, h, "second@example.com", "other")

	rec := authedPost(h, "/admin/mode", token, url.Values{"write": {"on"}})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("read-only admin enabling write mode should be 403, got %d", rec.Code)
	}
	if rec := authedPost(h, "/admin/tables/widgets/new", token,
		url.Values{"name": {"nope"}, "qty": {"0"}}); rec.Code != http.StatusForbidden {
		t.Fatalf("read-only admin write should be 403, got %d", rec.Code)
	}
}

func TestReadOnlyAdminSeesNoToggle(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	seedAdmin(t, pool, "second@example.com", "other", auth.RoleReadOnly)
	token := login(t, h, "second@example.com", "other")

	body := authedGet(h, "/admin/", token).Body.String()
	if strings.Contains(body, "enable write") {
		t.Error("read-only admin should not see the enable-write toggle")
	}
	if !strings.Contains(body, "read-only account") {
		t.Error("read-only admin should see the read-only badge")
	}
}

func TestExpiredWriteModeRejectsWrites(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	_, err := pool.Exec(context.Background(),
		`UPDATE admin_panel.admin_sessions SET write_mode_until = $2 WHERE token = $1`,
		token, time.Now().Add(-1*time.Minute))
	if err != nil {
		t.Fatalf("seed expired write mode: %v", err)
	}

	rec := authedPost(h, "/admin/tables/widgets/new", token,
		url.Values{"name": {"too-late"}, "qty": {"1"}})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expired write mode should be 403, got %d", rec.Code)
	}
}

func TestBannerShownOnlyInWriteMode(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	body := authedGet(h, "/admin/", token).Body.String()
	if strings.Contains(body, "WRITE MODE") {
		t.Error("banner should not render in read mode")
	}
	if !strings.Contains(body, "Read-only — enable write") {
		t.Error("topbar should offer the enable-write toggle in read mode")
	}

	enableWriteMode(t, pool, token)
	body = authedGet(h, "/admin/", token).Body.String()
	if !strings.Contains(body, "WRITE MODE") {
		t.Error("banner should render in write mode")
	}
	if !strings.Contains(body, "Switch back to read-only") {
		t.Error("banner should offer the disable-write button")
	}
}

func TestSafeRedirectRejectsExternalReturn(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	rec := authedPost(h, "/admin/mode", token,
		url.Values{"write": {"on"}, "return": {"https://evil.example.com/"}})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("toggle should still redirect, got %d", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "/admin/" {
		t.Errorf("expected redirect to safe /admin/, got %q", loc)
	}
}

func TestSchemaPickerSwitchesCookie(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	rec := authedPost(h, "/admin/schema", token,
		url.Values{"schema": {"admin_panel"}, "return": {"/admin/"}})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("switch to admin_panel should redirect, got %d", rec.Code)
	}
	var cookieVal string
	for _, c := range rec.Result().Cookies() {
		if c.Name == "admin_schema" {
			cookieVal = c.Value
		}
	}
	if cookieVal != "admin_panel" {
		t.Fatalf("expected admin_schema cookie set to admin_panel, got %q", cookieVal)
	}

	bad := authedPost(h, "/admin/schema", token, url.Values{"schema": {"pg_catalog"}})
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("system schema should be 400, got %d", bad.Code)
	}

	missing := authedPost(h, "/admin/schema", token, url.Values{"schema": {"nope"}})
	if missing.Code != http.StatusBadRequest {
		t.Fatalf("nonexistent schema should be 400, got %d", missing.Code)
	}
}

func TestNoInlineJSInAdminPages(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	paths := []string{"/admin/", "/admin/tables/widgets", "/admin/tables/widgets/new"}
	enableWriteMode(t, pool, token)
	bannedAttrs := []string{
		" onclick=", " onchange=", " onsubmit=", " oninput=",
		" onload=", " onkeyup=", " onfocus=", " onblur=",
		"<script>",
	}
	for _, p := range paths {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		body := rec.Body.String()
		for _, attr := range bannedAttrs {
			if strings.Contains(body, attr) {
				t.Errorf("%s: emits %q — CSP script-src 'self' will block; move to admin.js", p, strings.TrimSpace(attr))
			}
		}
	}
}

func TestAdminPagesSendNoStoreHeader(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	paths := []string{"/admin/", "/admin/tables/widgets"}
	for _, p := range paths {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		cc := rec.Header().Get("Cache-Control")
		if cc == "" || !strings.Contains(cc, "no-store") {
			t.Fatalf("%s: Cache-Control = %q, want no-store directive (back-button cache fix)", p, cc)
		}
	}
}

func TestSchemaPickerSwitchSurvivesNavigation(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	switchRec := authedPost(h, "/admin/schema", token,
		url.Values{"schema": {"admin_panel"}, "return": {"/admin/"}})
	if switchRec.Code != http.StatusSeeOther {
		t.Fatalf("schema switch: %d", switchRec.Code)
	}
	var schemaCookie *http.Cookie
	for _, c := range switchRec.Result().Cookies() {
		if c.Name == "admin_schema" {
			schemaCookie = c
		}
	}
	if schemaCookie == nil {
		t.Fatal("schema cookie not set on switch")
	}

	req := httptest.NewRequest(http.MethodGet, "/admin/", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	req.AddCookie(schemaCookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	body := rec.Body.String()
	if !strings.Contains(body, "Tables in admin_panel") {
		t.Fatalf("after switch, header should read 'Tables in admin_panel'; body=%s", body)
	}
	if !strings.Contains(body, "admin_users") {
		t.Fatal("admin_panel.admin_users should appear in the table list")
	}
	if strings.Contains(body, ">_prisma_migrations<") {
		t.Fatal("public-schema tables should NOT leak when schema=admin_panel")
	}
	if !strings.Contains(body, `<option value="admin_panel" selected>`) {
		t.Fatal("schema picker should mark admin_panel as selected")
	}
}

func TestAdminPanelBrowsable(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	req := httptest.NewRequest(http.MethodGet, "/admin/", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	req.AddCookie(&http.Cookie{Name: "admin_schema", Value: "admin_panel"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	body := rec.Body.String()
	if !strings.Contains(body, "admin_users") {
		t.Error("admin_panel schema should expose admin_users in the sidebar")
	}
}

func TestSelfRoleEditStripped(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")
	enableWriteMode(t, pool, token)

	var selfID int64
	_ = pool.QueryRow(context.Background(),
		`SELECT id FROM admin_panel.admin_users WHERE email = 'admin@example.com'`).Scan(&selfID)

	req := httptest.NewRequest(http.MethodPost,
		"/admin/tables/admin_users/"+strconv.FormatInt(selfID, 10),
		strings.NewReader(url.Values{
			"email": {"admin@example.com"},
			"role":  {"read_only"},
		}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	req.AddCookie(&http.Cookie{Name: "admin_schema", Value: "admin_panel"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("update should redirect, got %d", rec.Code)
	}

	var role string
	_ = pool.QueryRow(context.Background(),
		`SELECT role FROM admin_panel.admin_users WHERE id = $1`, selfID).Scan(&role)
	if role != "read_write" {
		t.Fatalf("self-role change should be stripped; got role=%q, want read_write", role)
	}
}

func TestSelfDeleteBlocked(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")
	enableWriteMode(t, pool, token)

	var selfID int64
	_ = pool.QueryRow(context.Background(),
		`SELECT id FROM admin_panel.admin_users WHERE email = 'admin@example.com'`).Scan(&selfID)

	req := httptest.NewRequest(http.MethodPost,
		"/admin/tables/admin_users/"+strconv.FormatInt(selfID, 10)+"/delete", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	req.AddCookie(&http.Cookie{Name: "admin_schema", Value: "admin_panel"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("self-delete should be 403, got %d", rec.Code)
	}

	var count int
	_ = pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM admin_panel.admin_users WHERE id = $1`, selfID).Scan(&count)
	if count != 1 {
		t.Fatal("self admin row should still exist after blocked self-delete")
	}
}

func TestOtherAdminEditableByReadWrite(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	seedAdmin(t, pool, "second@example.com", "other", auth.RoleReadOnly)
	token := login(t, h, "admin@example.com", "s3cret-pass")
	enableWriteMode(t, pool, token)

	var otherID int64
	_ = pool.QueryRow(context.Background(),
		`SELECT id FROM admin_panel.admin_users WHERE email = 'second@example.com'`).Scan(&otherID)

	req := httptest.NewRequest(http.MethodPost,
		"/admin/tables/admin_users/"+strconv.FormatInt(otherID, 10),
		strings.NewReader(url.Values{
			"email": {"second@example.com"},
			"role":  {"read_write"},
		}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	req.AddCookie(&http.Cookie{Name: "admin_schema", Value: "admin_panel"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("promoting another admin should redirect, got %d", rec.Code)
	}

	var role string
	_ = pool.QueryRow(context.Background(),
		`SELECT role FROM admin_panel.admin_users WHERE id = $1`, otherID).Scan(&role)
	if role != "read_write" {
		t.Fatalf("other admin's role should be updated to read_write, got %q", role)
	}
}

func seedAdmin(t *testing.T, pool *pgxpool.Pool, email, password, role string) {
	t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	_, err = pool.Exec(context.Background(),
		`INSERT INTO admin_panel.admin_users (email, password_hash, role)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
		email, hash, role)
	if err != nil {
		t.Fatalf("seedAdmin: %v", err)
	}
}
