package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"
)

func nowForTest() time.Time { return time.Now() }

func attrValue(t *testing.T, body, marker string) string {
	t.Helper()
	i := strings.Index(body, marker)
	if i < 0 {
		t.Fatalf("page is missing %s; body=%s", marker, body)
	}
	rest := body[i+len(marker):]
	j := strings.Index(rest, `"`)
	if j < 0 {
		t.Fatalf("malformed attribute %s", marker)
	}
	return rest[:j]
}

func enrollSecret(t *testing.T, h http.Handler, token string) (secret, recoveryCodes string) {
	t.Helper()
	rec := authedGet(h, "/admin/2fa/enroll", token)
	if rec.Code != http.StatusOK {
		t.Fatalf("enroll page should be 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	return attrValue(t, body, `data-secret="`), attrValue(t, body, `name="recovery_codes" value="`) // pragma: allowlist secret
}

func loginWithMfa(t *testing.T, h http.Handler, email, password string) (token, secret string) {
	t.Helper()
	token = login(t, h, email, password)
	if token == "" {
		t.Fatalf("login for %s yielded no session", email)
	}
	secret, codes := enrollSecret(t, h, token)
	code, err := totp.GenerateCode(secret, nowForTest())
	if err != nil {
		t.Fatalf("generate enrollment code: %v", err)
	}
	rec := authedPost(h, "/admin/2fa/enroll", token, url.Values{
		"code": {code}, "secret": {secret}, "recovery_codes": {codes},
	})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("enroll verify should redirect, got %d: %s", rec.Code, rec.Body.String())
	}
	return token, secret
}

func loginFull(t *testing.T, h http.Handler, email, password string) string {
	t.Helper()
	token, _ := loginWithMfa(t, h, email, password)
	return token
}

func getRecoveryPage(t *testing.T, h http.Handler, token string, enroll *httptest.ResponseRecorder) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/admin/2fa/recovery", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	for _, c := range enroll.Result().Cookies() {
		if c.Name == recoveryFlash {
			req.AddCookie(c)
		}
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Body.String()
}

func firstRecoveryCode(t *testing.T, body string) string {
	t.Helper()
	marker := `data-recovery="`
	i := strings.Index(body, marker)
	if i < 0 {
		t.Fatalf("recovery page must expose codes via data-recovery; body=%s", body)
	}
	rest := body[i+len(marker):]
	j := strings.Index(rest, `"`)
	if j < 0 {
		t.Fatal("malformed data-recovery attribute")
	}
	return rest[:j]
}

func TestFirstLoginBlockedFromAdminUntilEnrolled(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")
	if token == "" {
		t.Fatal("login should still issue a session cookie")
	}

	rec := authedGet(h, "/admin/", token)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("admin index must be inaccessible before enrollment, got %d", rec.Code)
	}
	if loc := rec.Header().Get("Location"); !strings.Contains(loc, "/admin/2fa") {
		t.Fatalf("pre-enrollment access must redirect into the 2FA flow, got %q", loc)
	}
}

func TestEnrollPageRendersFullAndFragment(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")

	full := authedGet(h, "/admin/2fa/enroll", token)
	if !strings.Contains(full.Body.String(), "<!doctype html>") {
		t.Fatal("non-HX enroll GET should return the full document")
	}

	req := httptest.NewRequest(http.MethodGet, "/admin/2fa/enroll", nil)
	req.Header.Set("HX-Request", "true")
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if strings.Contains(rec.Body.String(), "<!doctype html>") {
		t.Fatal("HX enroll GET should return a fragment, not the full document")
	}
}

func TestEnrollFailsWithWrongCode(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")
	secret, codes := enrollSecret(t, h, token)

	rec := authedPost(h, "/admin/2fa/enroll", token, url.Values{
		"code": {"000000"}, "secret": {secret}, "recovery_codes": {codes},
	})
	if rec.Code == http.StatusSeeOther {
		t.Fatal("enrollment with a wrong code must not complete")
	}
	if after := authedGet(h, "/admin/", token); after.Code != http.StatusSeeOther {
		t.Fatal("admin must still be blocked after a failed enrollment attempt")
	}
}

func TestEnrollCompletesAndIssuesRecoveryCodes(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")
	secret, codes := enrollSecret(t, h, token)
	code, _ := totp.GenerateCode(secret, nowForTest())

	rec := authedPost(h, "/admin/2fa/enroll", token, url.Values{
		"code": {code}, "secret": {secret}, "recovery_codes": {codes},
	})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("valid enrollment should redirect, got %d", rec.Code)
	}
	if !strings.Contains(rec.Header().Get("Location"), "/admin/2fa/recovery") {
		t.Fatalf("after enrollment user should be shown recovery codes once, got %q", rec.Header().Get("Location"))
	}
	page := getRecoveryPage(t, h, token, rec)
	if !strings.Contains(page, `data-recovery="`) {
		t.Fatal("recovery-codes page should display the issued codes once")
	}
	if rec := authedGet(h, "/admin/", token); rec.Code != http.StatusOK {
		t.Fatalf("admin index should be reachable once enrolled and verified, got %d", rec.Code)
	}
}

func TestPostEnrollmentLoginRequiresTOTP(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	loginWithMfa(t, h, "admin@example.com", "s3cret-pass1")

	token := login(t, h, "admin@example.com", "s3cret-pass1")
	if rec := authedGet(h, "/admin/", token); rec.Code != http.StatusSeeOther {
		t.Fatalf("a new session for an enrolled admin must be blocked until TOTP passes, got %d", rec.Code)
	}
	if loc := authedGet(h, "/admin/", token).Header().Get("Location"); !strings.Contains(loc, "/admin/2fa") {
		t.Fatalf("enrolled admin must be routed to the challenge, got %q", loc)
	}
	challenge := authedGet(h, "/admin/2fa", token)
	if challenge.Code != http.StatusOK {
		t.Fatalf("challenge page should render, got %d", challenge.Code)
	}
	if strings.Contains(challenge.Body.String(), "data-secret=") {
		t.Fatal("the challenge page must NOT leak the secret")
	}
}

func TestChallengeRejectsWrongCode(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	loginWithMfa(t, h, "admin@example.com", "s3cret-pass1")
	token := login(t, h, "admin@example.com", "s3cret-pass1")

	rec := authedPost(h, "/admin/2fa", token, url.Values{"code": {"000000"}})
	if rec.Code == http.StatusSeeOther {
		t.Fatal("a wrong challenge code must not grant access")
	}
	if after := authedGet(h, "/admin/", token); after.Code != http.StatusSeeOther {
		t.Fatal("admin must stay blocked after a wrong challenge code")
	}
}

func TestChallengeAcceptsValidCode(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	_, secret := loginWithMfa(t, h, "admin@example.com", "s3cret-pass1")
	token := login(t, h, "admin@example.com", "s3cret-pass1")

	code, _ := totp.GenerateCode(secret, nowForTest())
	rec := authedPost(h, "/admin/2fa", token, url.Values{"code": {code}})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("valid challenge code should grant access (redirect), got %d", rec.Code)
	}
	if after := authedGet(h, "/admin/", token); after.Code != http.StatusOK {
		t.Fatalf("admin index should be reachable after passing the challenge, got %d", after.Code)
	}
}

func TestRecoveryCodeWorksOnceAtChallenge(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")
	secret, codes := enrollSecret(t, h, token)
	code, _ := totp.GenerateCode(secret, nowForTest())
	enroll := authedPost(h, "/admin/2fa/enroll", token, url.Values{
		"code": {code}, "secret": {secret}, "recovery_codes": {codes},
	})
	if enroll.Code != http.StatusSeeOther {
		t.Fatalf("enroll: %d", enroll.Code)
	}
	recovery := firstRecoveryCode(t, getRecoveryPage(t, h, token, enroll))

	fresh := login(t, h, "admin@example.com", "s3cret-pass1")
	use := authedPost(h, "/admin/2fa", fresh, url.Values{"code": {recovery}})
	if use.Code != http.StatusSeeOther {
		t.Fatalf("recovery code should pass the challenge once, got %d", use.Code)
	}

	again := login(t, h, "admin@example.com", "s3cret-pass1")
	reuse := authedPost(h, "/admin/2fa", again, url.Values{"code": {recovery}})
	if reuse.Code == http.StatusSeeOther {
		t.Fatal("a recovery code must not be reusable")
	}
}

func TestChallengeLocksOutAfterRepeatedWrongCodes(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	_, secret := loginWithMfa(t, h, "admin@example.com", "s3cret-pass1")
	token := login(t, h, "admin@example.com", "s3cret-pass1")

	for i := 0; i < 5; i++ {
		authedPost(h, "/admin/2fa", token, url.Values{"code": {"000000"}})
	}

	code, _ := totp.GenerateCode(secret, nowForTest())
	rec := authedPost(h, "/admin/2fa", token, url.Values{"code": {code}})
	if rec.Code == http.StatusSeeOther {
		t.Fatal("a locked account must not be granted access even with a correct code")
	}
	body := rec.Body.String()
	if !strings.Contains(body, "Too many attempts") {
		t.Fatalf("locked challenge must show a throttling message, got %q", body)
	}
	if strings.Contains(body, "Invalid authentication code") {
		t.Fatal("the locked error must not reveal whether the submitted code was correct")
	}
	if after := authedGet(h, "/admin/", token); after.Code != http.StatusSeeOther {
		t.Fatal("admin must stay blocked while locked out")
	}
}

func TestEveryAdminRouteGuardedUntilMFA(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")

	paths := []string{
		"/admin/",
		"/admin/tables/widgets",
		"/admin/tables/widgets/new",
		"/admin/tables/widgets.csv",
	}
	for _, p := range paths {
		rec := authedGet(h, p, token)
		if rec.Code != http.StatusSeeOther {
			t.Errorf("GET %s must be blocked before MFA, got %d", p, rec.Code)
		}
		if loc := rec.Header().Get("Location"); !strings.Contains(loc, "/admin/2fa") {
			t.Errorf("GET %s should redirect to the 2FA flow, got %q", p, loc)
		}
	}
	for _, p := range []string{"/admin/mode", "/admin/tables/widgets/new"} {
		rec := authedPost(h, p, token, url.Values{"write": {"on"}})
		if rec.Code != http.StatusSeeOther {
			t.Errorf("POST %s must be blocked before MFA, got %d", p, rec.Code)
		}
	}
}

func TestEnrollPageRedirectsWhenAlreadyEnrolled(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")

	rec := authedGet(h, "/admin/2fa/enroll", token)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("enrolled admin hitting enroll should redirect, got %d", rec.Code)
	}
	if loc := rec.Header().Get("Location"); !strings.Contains(loc, "/admin/2fa") {
		t.Fatalf("should redirect to the challenge, got %q", loc)
	}
}

func TestChallengeRedirectsToEnrollWhenNotEnrolled(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")

	rec := authedGet(h, "/admin/2fa", token)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("un-enrolled admin on challenge should redirect, got %d", rec.Code)
	}
	if loc := rec.Header().Get("Location"); !strings.Contains(loc, "/2fa/enroll") {
		t.Fatalf("should route to enrollment, got %q", loc)
	}
}

func TestChallengePageRedirectsWhenAlreadyPassed(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := loginFull(t, h, "admin@example.com", "s3cret-pass1")

	rec := authedGet(h, "/admin/2fa", token)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("a passed session on the challenge should redirect home, got %d", rec.Code)
	}
}

func TestEnrollWrongCodeReRendersWithOtpauthLink(t *testing.T) {
	pool := testPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass1")
	secret, codes := enrollSecret(t, h, token)

	rec := authedPost(h, "/admin/2fa/enroll", token, url.Values{
		"code": {"000000"}, "secret": {secret}, "recovery_codes": {codes},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("wrong enroll code should re-render the form, got %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "otpauth://totp/") {
		t.Fatal("re-rendered enroll form should rebuild the otpauth link from the carried secret")
	}
	if !strings.Contains(body, `data-secret="`+secret+`"`) { // pragma: allowlist secret
		t.Fatal("re-rendered enroll form should preserve the same secret")
	}
}
