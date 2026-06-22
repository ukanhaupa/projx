package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/pquerna/otp/totp"
)

func htmxPost(h http.Handler, path, token string, form url.Values) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("HX-Request", "true")
	if token != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestHTMXLoginRevealsCodeStepInPlace(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	loginWithMfa(t, h, "admin@example.com", "s3cret-pass1")

	rec := htmxPost(h, "/admin/login", "", url.Values{
		"email": {"admin@example.com"}, "password": {"s3cret-pass1"},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("HTMX login should return a 200 fragment, got %d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, "<html") {
		t.Fatal("HTMX login response must be a fragment, not a full page")
	}
	if !strings.Contains(body, `name="code"`) {
		t.Fatalf("HTMX login (enrolled) should reveal the code field in place; body=%s", body)
	}
	if strings.Contains(body, `name="password"`) {
		t.Fatal("the password field should be swapped out for the code field")
	}
	var hasCookie bool
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookie {
			hasCookie = true
		}
	}
	if !hasCookie {
		t.Fatal("login should set the session cookie before the code step")
	}
}

func TestHTMXLoginBadPasswordShowsErrorFragment(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()

	rec := htmxPost(h, "/admin/login", "", url.Values{
		"email": {"admin@example.com"}, "password": {"wrong-password"},
	})
	body := rec.Body.String()
	if strings.Contains(body, "<html") {
		t.Fatal("error response must be a fragment, not a full page")
	}
	if !strings.Contains(body, "Invalid email or password") {
		t.Fatalf("bad password should show an inline error; body=%s", body)
	}
	if !strings.Contains(body, `name="password"`) {
		t.Fatal("a failed password attempt should keep the password step")
	}
}

func TestHTMXLoginNotEnrolledRedirectsToEnroll(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()

	rec := htmxPost(h, "/admin/login", "", url.Values{
		"email": {"admin@example.com"}, "password": {"s3cret-pass1"},
	})
	if loc := rec.Header().Get("HX-Redirect"); loc != "/admin/2fa/enroll" {
		t.Fatalf("a not-enrolled admin should be sent to enrollment; HX-Redirect=%q", loc)
	}
}

func TestHTMXChallengeSuccessHXRedirects(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	_, secret := loginWithMfa(t, h, "admin@example.com", "s3cret-pass1")

	fresh := login(t, h, "admin@example.com", "s3cret-pass1")
	code, err := totp.GenerateCode(secret, nowForTest())
	if err != nil {
		t.Fatalf("totp: %v", err)
	}
	rec := htmxPost(h, "/admin/2fa", fresh, url.Values{"code": {code}})
	if rec.Code != http.StatusOK {
		t.Fatalf("HTMX challenge success should be 200 + HX-Redirect, got %d", rec.Code)
	}
	if loc := rec.Header().Get("HX-Redirect"); loc != "/admin/" {
		t.Fatalf("HX-Redirect = %q, want /admin/", loc)
	}
}

func TestHTMXChallengeBadCodeShowsErrorFragment(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	loginWithMfa(t, h, "admin@example.com", "s3cret-pass1")

	fresh := login(t, h, "admin@example.com", "s3cret-pass1")
	rec := htmxPost(h, "/admin/2fa", fresh, url.Values{"code": {"000000"}})
	if rec.Header().Get("HX-Redirect") != "" {
		t.Fatal("a wrong code must not redirect")
	}
	body := rec.Body.String()
	if strings.Contains(body, "<html") {
		t.Fatal("error response must be a fragment, not a full page")
	}
	if !strings.Contains(body, "Invalid authentication code") {
		t.Fatalf("wrong code should show an inline error; body=%s", body)
	}
	if !strings.Contains(body, `name="code"`) {
		t.Fatal("the code step should remain so the user can retry")
	}
}
