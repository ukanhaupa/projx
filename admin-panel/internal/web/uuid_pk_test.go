package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUUIDPrimaryKeyRendersAsCanonicalString(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	for _, stmt := range []string{
		`DROP TABLE IF EXISTS public.uuid_widgets`,
		`CREATE TABLE public.uuid_widgets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), label TEXT NOT NULL)`,
		`INSERT INTO public.uuid_widgets (id, label) VALUES ('4611347e-320f-4d27-8621-ddbadbff0011', 'first')`,
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("seed %q: %v", stmt, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DROP TABLE IF EXISTS public.uuid_widgets`)
	})

	srv := newTestServer(t, pool)
	h := srv.Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)

	req := httptest.NewRequest(http.MethodGet, "/admin/tables/uuid_widgets", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("explorer status %d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, "4611347e-320f-4d27-8621-ddbadbff0011") {
		t.Fatalf("expected canonical uuid in body; got=%s", body)
	}
	if strings.Contains(body, "[70 17 52 126") {
		t.Fatalf("body contains raw byte-array literal — uuid not formatted: %s", body)
	}
	if !strings.Contains(body, `/admin/tables/uuid_widgets/4611347e-320f-4d27-8621-ddbadbff0011`) {
		t.Fatalf("edit link should embed canonical uuid; body=%s", body)
	}
}

func TestUUIDPrimaryKeyEditFlowRoundTrips(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	for _, stmt := range []string{
		`DROP TABLE IF EXISTS public.uuid_widgets`,
		`CREATE TABLE public.uuid_widgets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), label TEXT NOT NULL)`,
		`INSERT INTO public.uuid_widgets (id, label) VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'first')`,
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("seed %q: %v", stmt, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DROP TABLE IF EXISTS public.uuid_widgets`)
	})

	srv := newTestServer(t, pool)
	h := srv.Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")
	enableWriteMode(t, pool, token)

	req := httptest.NewRequest(http.MethodGet,
		"/admin/tables/uuid_widgets/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("edit form status %d, body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, "first") {
		t.Fatalf("edit form should pre-fill label=first; body=%s", body)
	}
	if !strings.Contains(body, `value="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"`) {
		t.Fatalf("edit form should show canonical uuid as id value; body=%s", body)
	}
}
