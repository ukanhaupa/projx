package tests

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"projx.local/go/ent/enttest"
	"projx.local/go/internal/auth/handlers"
	"projx.local/go/internal/auth/mailer"
	authservice "projx.local/go/internal/auth/service"
)

func setEncryptionKey(t *testing.T) {
	t.Helper()
	if os.Getenv("CRED_ENCRYPTION_KEY") != "" {
		return
	}
	buf := make([]byte, 32)
	_, err := rand.Read(buf)
	require.NoError(t, err)
	t.Setenv("CRED_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(buf))
}

func newTestDeps(t *testing.T) *handlers.Deps {
	t.Helper()
	t.Setenv("JWT_SECRET", "test-secret-do-not-use-in-prod")
	setEncryptionKey(t)
	client := enttest.Open(t, "sqlite3", "file:ent?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })

	signer := authservice.NewSigner(nil)
	cipher := authservice.NewCipher(nil)
	svc := authservice.NewService(client, signer, cipher)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return &handlers.Deps{
		Service: svc,
		Mailer:  mailer.New(logger),
		Logger:  logger,
	}
}

func doJSON(t *testing.T, r http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		require.NoError(t, err)
		reader = strings.NewReader(string(buf))
	} else {
		reader = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestSignupLoginFlow(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test")
	}
	deps := newTestDeps(t)
	router := deps.Routes()

	rec := doJSON(t, router, "POST", "/signup", map[string]any{
		"email":    "alice@example.com",
		"name":     "Alice",
		"password": "s3cretPass!",
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	var signup map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &signup))
	assert.NotEmpty(t, signup["access_token"])
	assert.NotEmpty(t, signup["refresh_token"])

	rec = doJSON(t, router, "POST", "/login", map[string]any{
		"email":    "alice@example.com",
		"password": "s3cretPass!",
	})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = doJSON(t, router, "POST", "/login", map[string]any{
		"email":    "alice@example.com",
		"password": "wrong",
	})
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestRefreshRotationAndReplayDetection(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test")
	}
	deps := newTestDeps(t)
	router := deps.Routes()

	rec := doJSON(t, router, "POST", "/signup", map[string]any{
		"email":    "bob@example.com",
		"name":     "Bob",
		"password": "anotherPass1!",
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	var session map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &session))
	refresh, _ := session["refresh_token"].(string)
	require.NotEmpty(t, refresh)

	rec = doJSON(t, router, "POST", "/refresh", map[string]any{"refresh_token": refresh})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = doJSON(t, router, "POST", "/refresh", map[string]any{"refresh_token": refresh})
	require.Equal(t, http.StatusUnauthorized, rec.Code)
	var payload map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	assert.Equal(t, "token_replay_detected", payload["detail"])
}

func TestForgotResetPassword(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test")
	}
	t.Setenv("AUTH_DEBUG_TOKENS", "true")
	deps := newTestDeps(t)
	router := deps.Routes()

	_ = doJSON(t, router, "POST", "/signup", map[string]any{
		"email":    "carol@example.com",
		"name":     "Carol",
		"password": "initPass1!",
	})

	rec := doJSON(t, router, "POST", "/forgot-password", map[string]any{
		"email": "carol@example.com",
	})
	require.Equal(t, http.StatusOK, rec.Code)
	var forgot map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &forgot))
	token, _ := forgot["reset_token"].(string)
	require.NotEmpty(t, token, "reset_token should be returned when AUTH_DEBUG_TOKENS=true")

	rec = doJSON(t, router, "POST", "/reset-password", map[string]any{
		"token":        token,
		"new_password": "newPass1!",
	})
	require.Equal(t, http.StatusOK, rec.Code)

	rec = doJSON(t, router, "POST", "/login", map[string]any{
		"email":    "carol@example.com",
		"password": "newPass1!",
	})
	require.Equal(t, http.StatusOK, rec.Code)

	ctx := context.Background()
	count, err := deps.Service.Client().Session.Query().Count(ctx)
	require.NoError(t, err)
	assert.Positive(t, count)
}

func TestEmailVerifyFlow(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test")
	}
	deps := newTestDeps(t)
	router := deps.Routes()
	_ = doJSON(t, router, "POST", "/signup", map[string]any{
		"email":    "dave@example.com",
		"name":     "Dave",
		"password": "davePass1!",
	})

	ctx := context.Background()
	u, err := deps.Service.FindUserByEmail(ctx, "dave@example.com")
	require.NoError(t, err)
	raw, err := authservice.RandomToken()
	require.NoError(t, err)
	_, err = deps.Service.CreateEmailVerifyToken(ctx, u.ID, authservice.HashToken(raw), authservice.EmailVerifyTokenTTL)
	require.NoError(t, err)

	rec := doJSON(t, router, "POST", "/verify-email", map[string]any{"token": raw})
	require.Equal(t, http.StatusOK, rec.Code)

	fresh, err := deps.Service.FindUserByID(ctx, u.ID)
	require.NoError(t, err)
	assert.True(t, fresh.EmailVerified)
	assert.NotNil(t, fresh.EmailVerifiedAt)
}
