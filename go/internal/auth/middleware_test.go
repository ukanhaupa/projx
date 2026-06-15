package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type errEnvelope struct {
	Detail    string `json:"detail"`
	RequestID string `json:"request_id"`
}

func mustVerifier(t *testing.T) *Verifier {
	t.Helper()
	v, err := NewVerifier(Config{
		Provider:   ProviderSharedSecret,
		Secret:     []byte(testSecret),
		Algorithms: []string{"HS256"},
	})
	require.NoError(t, err)
	return v
}

func TestExtractBearer(t *testing.T) {
	assert.Equal(t, "", extractBearer(""))
	assert.Equal(t, "", extractBearer("Basic abc"))
	assert.Equal(t, "", extractBearer("Bearer"))
	assert.Equal(t, "abc.def.ghi", extractBearer("Bearer abc.def.ghi"))
	assert.Equal(t, "abc.def.ghi", extractBearer("bearer abc.def.ghi"))
	assert.Equal(t, "abc.def.ghi", extractBearer("Bearer  abc.def.ghi  "))
}

func TestAuthenticatePassesThroughWhenNoToken(t *testing.T) {
	v := mustVerifier(t)
	called := false
	var seenUser *AuthUser
	var seenOK bool
	next := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		called = true
		seenUser, seenOK = FromContext(r.Context())
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	Authenticate(v)(next).ServeHTTP(rec, req)

	assert.True(t, called)
	assert.False(t, seenOK)
	assert.Nil(t, seenUser)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestAuthenticateAttachesAuthUser(t *testing.T) {
	v := mustVerifier(t)
	token := signHS256(t, jwt.MapClaims{
		"sub":         "user-42",
		"email":       "u@example.com",
		"role":        "admin",
		"permissions": []string{"posts:read"},
		"sid":         "sess-1",
		"exp":         time.Now().Add(time.Hour).Unix(),
	}, testSecret)

	var seen *AuthUser
	next := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen, _ = FromContext(r.Context())
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	Authenticate(v)(next).ServeHTTP(rec, req)

	require.NotNil(t, seen)
	assert.Equal(t, "user-42", seen.ID)
	assert.Equal(t, "u@example.com", seen.Email)
	assert.Equal(t, "admin", seen.Role)
	assert.Equal(t, []string{"posts:read"}, seen.Permissions)
	assert.Equal(t, "sess-1", seen.SID)
}

func TestAuthenticateRejectsInvalidTokenWith401(t *testing.T) {
	v := mustVerifier(t)
	next := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		t.Fatal("next should not be called when token is invalid")
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer bogus.token.here")
	Authenticate(v)(next).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	var env errEnvelope
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env))
	assert.NotEmpty(t, env.Detail)
}

func TestAuthzRequireAuthRejectsAnonymous(t *testing.T) {
	next := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		t.Fatal("next should not be called when unauthenticated")
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	AuthzRequireAuth(next).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	var env errEnvelope
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env))
	assert.Equal(t, "authentication required", env.Detail)
}

func TestAuthzRequireAuthAllowsAuthenticated(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := context.WithValue(req.Context(), authUserKey, &AuthUser{ID: "u1"})
	AuthzRequireAuth(next).ServeHTTP(rec, req.WithContext(ctx))

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestAuthzRequireRoleRejectsAnonymousWith401(t *testing.T) {
	next := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		t.Fatal("next should not be called when unauthenticated")
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	AuthzRequireRole("admin")(next).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestAuthzRequireRoleRejectsWrongRoleWith403(t *testing.T) {
	next := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		t.Fatal("next should not be called when role mismatched")
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := context.WithValue(req.Context(), authUserKey, &AuthUser{ID: "u1", Role: "viewer"})
	AuthzRequireRole("admin", "owner")(next).ServeHTTP(rec, req.WithContext(ctx))

	assert.Equal(t, http.StatusForbidden, rec.Code)
	var env errEnvelope
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env))
	assert.Equal(t, "insufficient role", env.Detail)
}

func TestAuthzRequireRoleAllowsMatchingRole(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := context.WithValue(req.Context(), authUserKey, &AuthUser{ID: "u1", Role: "admin"})
	AuthzRequireRole("admin", "owner")(next).ServeHTTP(rec, req.WithContext(ctx))

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestFromContextReturnsFalseWhenAbsent(t *testing.T) {
	user, ok := FromContext(context.Background())
	assert.Nil(t, user)
	assert.False(t, ok)
}

func TestFromContextHandlesWrongType(t *testing.T) {
	ctx := context.WithValue(context.Background(), authUserKey, "not-an-auth-user")
	user, ok := FromContext(ctx)
	assert.Nil(t, user)
	assert.False(t, ok)
}

func TestToAuthUserNormalizesNilPermissions(t *testing.T) {
	u := toAuthUser(&Claims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: "u1"},
	})
	assert.NotNil(t, u.Permissions)
	assert.Empty(t, u.Permissions)
}
