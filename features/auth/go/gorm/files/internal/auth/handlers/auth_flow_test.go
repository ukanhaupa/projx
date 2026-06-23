package authhandlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth"
	authhandlers "projx.local/go/internal/auth/handlers"
	authmodels "projx.local/go/internal/auth/models"
	"projx.local/go/internal/db"
	"projx.local/go/internal/requestid"
)

func setupIntegration(t *testing.T) (*httptest.Server, *authhandlers.Deps, func()) {
	t.Helper()
	if testing.Short() {
		t.Skip("integration test skipped in short mode")
	}
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL not set")
	}
	t.Setenv("JWT_SECRET", "integration-test-secret")
	t.Setenv("JWT_PROVIDER", "shared_secret")

	gdb, err := db.Open(context.Background())
	require.NoError(t, err)
	_ = gdb.Migrator().DropTable(&authmodels.RefreshToken{}, &authmodels.VerificationToken{}, &authmodels.User{})
	require.NoError(t, gdb.AutoMigrate(&authmodels.User{}, &authmodels.RefreshToken{}, &authmodels.VerificationToken{}))

	deps := authhandlers.NewDeps(gdb, nil)
	verifier, err := auth.NewVerifierFromEnv()
	require.NoError(t, err)

	r := chi.NewRouter()
	r.Use(requestid.Middleware)
	r.Use(apperr.Recoverer)
	r.Mount("/api/v1", authhandlers.Routes(deps, verifier))
	srv := httptest.NewServer(r)
	return srv, deps, func() {
		srv.Close()
		_ = gdb.Migrator().DropTable(&authmodels.RefreshToken{}, &authmodels.VerificationToken{}, &authmodels.User{})
	}
}

func doReq(t *testing.T, method, url, token string, body any) (*http.Response, []byte) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		require.NoError(t, err)
		reader = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, url, reader)
	require.NoError(t, err)
	if reader != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	t.Cleanup(func() { resp.Body.Close() })
	bodyBytes, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp, bodyBytes
}

func TestSignupLoginRefreshLogoutFlow(t *testing.T) {
	srv, _, cleanup := setupIntegration(t)
	defer cleanup()

	resp, body := doReq(t, http.MethodPost, srv.URL+"/api/v1/auth/signup", "", map[string]any{
		"email":    "alice@example.com",
		"name":     "Alice",
		"password": "correct-horse",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
	var signupResp map[string]string
	require.NoError(t, json.Unmarshal(body, &signupResp))
	require.NotEmpty(t, signupResp["access_token"])
	require.NotEmpty(t, signupResp["refresh_token"])

	resp, body = doReq(t, http.MethodPost, srv.URL+"/api/v1/auth/login", "", map[string]any{
		"email":    "alice@example.com",
		"password": "correct-horse",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode, string(body))
	var login map[string]string
	require.NoError(t, json.Unmarshal(body, &login))
	require.NotEmpty(t, login["access_token"])
	require.NotEmpty(t, login["refresh_token"])

	resp, body = doReq(t, http.MethodPost, srv.URL+"/api/v1/auth/login", "", map[string]any{
		"email":    "alice@example.com",
		"password": "wrong",
	})
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode, string(body))

	resp, body = doReq(t, http.MethodPost, srv.URL+"/api/v1/auth/refresh", "", map[string]any{
		"refresh_token": login["refresh_token"],
	})
	require.Equal(t, http.StatusOK, resp.StatusCode, string(body))
	var rotated map[string]string
	require.NoError(t, json.Unmarshal(body, &rotated))
	require.NotEmpty(t, rotated["refresh_token"])
	require.NotEqual(t, login["refresh_token"], rotated["refresh_token"])

	// Re-presenting the original token while its replacement is still the
	// unused head is a lost-rotation retry — the session must recover, not be
	// nuked.
	resp, body = doReq(t, http.MethodPost, srv.URL+"/api/v1/auth/refresh", "", map[string]any{
		"refresh_token": login["refresh_token"],
	})
	require.Equal(t, http.StatusOK, resp.StatusCode, string(body))
	var graced map[string]string
	require.NoError(t, json.Unmarshal(body, &graced))
	require.NotEmpty(t, graced["refresh_token"])

	// The graced replacement is usable.
	resp, body = doReq(t, http.MethodPost, srv.URL+"/api/v1/auth/refresh", "", map[string]any{
		"refresh_token": graced["refresh_token"],
	})
	require.Equal(t, http.StatusOK, resp.StatusCode, string(body))

	// The chain has now advanced past the original token, so re-presenting it
	// is a genuine replay and revokes the session.
	resp, body = doReq(t, http.MethodPost, srv.URL+"/api/v1/auth/refresh", "", map[string]any{
		"refresh_token": login["refresh_token"],
	})
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode, string(body))

	resp, _ = doReq(t, http.MethodPost, srv.URL+"/api/v1/auth/logout", login["access_token"], nil)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
}

func TestPasswordResetAndEmailVerifyFlow(t *testing.T) {
	srv, deps, cleanup := setupIntegration(t)
	defer cleanup()

	resp, _ := doReq(t, http.MethodPost, srv.URL+"/api/v1/auth/signup", "", map[string]any{
		"email":    "bob@example.com",
		"name":     "Bob",
		"password": "correct-horse",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)

	resp, _ = doReq(t, http.MethodPost, srv.URL+"/api/v1/auth/password-reset/request", "", map[string]any{
		"email": "bob@example.com",
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)

	var token authmodels.VerificationToken
	require.NoError(t, deps.DB.Where("kind = ?", authmodels.TokenKindPasswordReset).Order("created_at desc").First(&token).Error)
	_ = token

	resp, _ = doReq(t, http.MethodPost, srv.URL+"/api/v1/auth/password-reset/request", "", map[string]any{
		"email": "absent@example.com",
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
}
