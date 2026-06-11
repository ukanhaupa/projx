package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHXRequestReturnsFragmentNotFullPage(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")

	req := httptest.NewRequest(http.MethodGet, "/admin/tables/widgets", nil)
	req.Header.Set("HX-Request", "true")
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, "<!doctype html>") || strings.Contains(body, "<html") {
		t.Fatalf("HX-Request response should NOT contain full <html>; got=%s", body[:min(200, len(body))])
	}
	if !strings.Contains(body, `id="table-region"`) {
		t.Fatalf("HX response should include #table-region; body=%s", body[:min(200, len(body))])
	}
	if !strings.Contains(body, "table-scroll") {
		t.Fatal("HX response should include table-scroll container")
	}
}

func TestRegularGETReturnsFullPage(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")

	req := httptest.NewRequest(http.MethodGet, "/admin/tables/widgets", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	body := rec.Body.String()
	if !strings.Contains(body, "<!doctype html>") {
		t.Fatal("non-HX GET should return full HTML document with doctype")
	}
	if !strings.Contains(body, `id="table-region"`) {
		t.Fatal("full page should also contain #table-region (so first paint is hydratable)")
	}
}

func TestHXRequestWithFilterRendersFragmentWithChip(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")

	req := httptest.NewRequest(http.MethodGet, "/admin/tables/widgets?f.name.eq=alpha", nil)
	req.Header.Set("HX-Request", "true")
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	body := rec.Body.String()
	if !strings.Contains(body, "active-filters") {
		t.Fatalf("filter chip should render in fragment; body=%s", body[:min(400, len(body))])
	}
}

func TestAddFilterHXPushesNewURL(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")

	req := httptest.NewRequest(http.MethodGet,
		"/admin/tables/widgets/_filter?filter_col=name&filter_op=eq&filter_val=alpha", nil)
	req.Header.Set("HX-Request", "true")
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("HX addFilter should return 200 (fragment), got %d", rec.Code)
	}
	push := rec.Header().Get("HX-Push-Url")
	if !strings.Contains(push, "f.name.eq=alpha") {
		t.Fatalf("HX-Push-Url should embed new filter; got %q", push)
	}
}

func TestAddFilterNonHXRedirects(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")

	req := httptest.NewRequest(http.MethodGet,
		"/admin/tables/widgets/_filter?filter_col=name&filter_op=eq&filter_val=alpha", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("non-HX addFilter should redirect (303), got %d", rec.Code)
	}
	loc := rec.Header().Get("Location")
	if !strings.Contains(loc, "f.name.eq=alpha") {
		t.Fatalf("redirect Location should embed new filter; got %q", loc)
	}
}

func TestEmptyRowsRendersInFragment(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")

	req := httptest.NewRequest(http.MethodGet,
		"/admin/tables/widgets?f.name.eq=__nope__", nil)
	req.Header.Set("HX-Request", "true")
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), "No rows") {
		t.Fatal("empty result should render the 'No rows' message in fragment")
	}
}
