package cors

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"projx.local/go/internal/requestid"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
}

func TestPreflightSetsAccessControlHeaders(t *testing.T) {
	mw := Middleware(Options{
		AllowedOrigins:   []string{"https://app.example.com"},
		AllowCredentials: true,
	})

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/posts", nil)
	req.Header.Set("Origin", "https://app.example.com")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "Content-Type, Authorization")
	rec := httptest.NewRecorder()

	mw(okHandler()).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, "https://app.example.com", rec.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "true", rec.Header().Get("Access-Control-Allow-Credentials"))
	assert.Contains(t, rec.Header().Get("Access-Control-Allow-Methods"), "POST")
	assert.Contains(t, rec.Header().Get("Access-Control-Allow-Methods"), "OPTIONS")
	assert.Contains(t, rec.Header().Get("Access-Control-Allow-Headers"), "Authorization")
	assert.Equal(t, "600", rec.Header().Get("Access-Control-Max-Age"))
	vary := rec.Header().Values("Vary")
	assert.Contains(t, vary, "Origin")
}

func TestCrossOriginGetPassesThrough(t *testing.T) {
	mw := Middleware(Options{
		AllowedOrigins: []string{"https://app.example.com"},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "https://app.example.com")
	rec := httptest.NewRecorder()

	mw(okHandler()).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "ok", rec.Body.String())
	assert.Equal(t, "https://app.example.com", rec.Header().Get("Access-Control-Allow-Origin"))
}

func TestRequestWithoutOriginPassesThrough(t *testing.T) {
	mw := Middleware(Options{
		AllowedOrigins: []string{"https://app.example.com"},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()

	mw(okHandler()).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"))
}

func TestDisallowedOriginReturns403(t *testing.T) {
	mw := Middleware(Options{
		AllowedOrigins: []string{"https://app.example.com"},
	})
	wrapped := requestid.Middleware(mw(okHandler()))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/posts", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	rec := httptest.NewRecorder()

	wrapped.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Contains(t, rec.Body.String(), "origin not allowed")
	assert.Contains(t, rec.Body.String(), "request_id")
}

func TestDisallowedPreflightReturns403(t *testing.T) {
	mw := Middleware(Options{
		AllowedOrigins: []string{"https://app.example.com"},
	})

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/posts", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	req.Header.Set("Access-Control-Request-Method", "POST")
	rec := httptest.NewRecorder()

	mw(okHandler()).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
}

func TestWildcardAllowedWithoutCredentials(t *testing.T) {
	mw := Middleware(Options{
		AllowedOrigins: []string{"*"},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "https://anywhere.example.com")
	rec := httptest.NewRecorder()

	mw(okHandler()).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "*", rec.Header().Get("Access-Control-Allow-Origin"))
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Credentials"))
}

func TestWildcardRejectedWithCredentials(t *testing.T) {
	assert.Panics(t, func() {
		Middleware(Options{
			AllowedOrigins:   []string{"*"},
			AllowCredentials: true,
		})
	})
}

func TestPreflightWithoutRequestMethodIsTreatedAsRegular(t *testing.T) {
	mw := Middleware(Options{
		AllowedOrigins: []string{"https://app.example.com"},
	})

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/posts", nil)
	req.Header.Set("Origin", "https://app.example.com")
	rec := httptest.NewRecorder()

	mw(okHandler()).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Methods"))
}

func TestDefaultMiddlewareReadsEnv(t *testing.T) {
	t.Setenv(EnvAllowOrigins, "https://one.example.com, https://two.example.com")

	mw := DefaultMiddleware()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "https://two.example.com")
	rec := httptest.NewRecorder()

	mw(okHandler()).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "https://two.example.com", rec.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "true", rec.Header().Get("Access-Control-Allow-Credentials"))
}

func TestDefaultMiddlewareFallsBackWhenEnvEmpty(t *testing.T) {
	require.NoError(t, os.Unsetenv(EnvAllowOrigins))

	mw := DefaultMiddleware()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	mw(okHandler()).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "http://localhost:5173", rec.Header().Get("Access-Control-Allow-Origin"))
}

func TestCustomMethodsAndHeadersAndMaxAge(t *testing.T) {
	mw := Middleware(Options{
		AllowedOrigins: []string{"https://app.example.com"},
		AllowedMethods: []string{http.MethodGet, http.MethodPut},
		AllowedHeaders: []string{"X-Custom"},
		MaxAge:         120,
	})

	req := httptest.NewRequest(http.MethodOptions, "/x", nil)
	req.Header.Set("Origin", "https://app.example.com")
	req.Header.Set("Access-Control-Request-Method", "PUT")
	rec := httptest.NewRecorder()

	mw(okHandler()).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, "GET, PUT", rec.Header().Get("Access-Control-Allow-Methods"))
	assert.Equal(t, "X-Custom", rec.Header().Get("Access-Control-Allow-Headers"))
	assert.Equal(t, "120", rec.Header().Get("Access-Control-Max-Age"))
}

func TestParseOriginsTrimsAndDropsEmpty(t *testing.T) {
	assert.Equal(t, []string{"https://a", "https://b"}, parseOrigins("  https://a , ,https://b , "))
	assert.Nil(t, parseOrigins(""))
	assert.Nil(t, parseOrigins("   "))
}
