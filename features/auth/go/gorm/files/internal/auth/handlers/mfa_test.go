package authhandlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"projx.local/go/internal/auth"
)

func newAccessToken(t *testing.T, userID, sessionID string) string {
	t.Helper()
	claims := jwt.MapClaims{
		"sub":         userID,
		"sid":         sessionID,
		"email":       "u@example.com",
		"name":        "User",
		"role":        "user",
		"permissions": []string{"*:read.*"},
		"token_type":  "access",
		"jti":         "jti-1",
		"exp":         9999999999,
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString([]byte("test-secret"))
	require.NoError(t, err)
	return signed
}

func newVerifier(t *testing.T) *auth.Verifier {
	t.Helper()
	v, err := auth.NewVerifier(auth.Config{
		Provider:   auth.ProviderSharedSecret,
		Secret:     []byte("test-secret"),
		Algorithms: []string{"HS256"},
	})
	require.NoError(t, err)
	return v
}

func routedRequest(t *testing.T, d *Deps, method, target string, body []byte, userID, sessionID string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	var r *http.Request
	if body != nil {
		r = httptest.NewRequest(method, target, bytes.NewReader(body))
	} else {
		r = httptest.NewRequest(method, target, nil)
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+newAccessToken(t, userID, sessionID))
	Routes(d, newVerifier(t)).ServeHTTP(w, r)
	return w
}

func TestMFAEnrollUnauthenticated(t *testing.T) {
	d, _, done := newMockDeps(t)
	defer done()
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/mfa/enroll", nil)
	Routes(d, newVerifier(t)).ServeHTTP(w, r)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestMFAVerifyRejectsInvalidBody(t *testing.T) {
	d, _, done := newMockDeps(t)
	defer done()
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/mfa/verify", strings.NewReader("garbage"))
	r.Header.Set("Authorization", "Bearer "+newAccessToken(t, "u1", "s1"))
	Routes(d, newVerifier(t)).ServeHTTP(w, r)
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestMFADisableMissingFields(t *testing.T) {
	d, _, done := newMockDeps(t)
	defer done()
	body, _ := json.Marshal(map[string]any{})
	w := routedRequest(t, d, http.MethodPost, "/auth/mfa/disable", body, "u1", "s1")
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestEmailVerifyRequestMissingUser(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnError(gorm.ErrRecordNotFound)
	w := routedRequest(t, d, http.MethodPost, "/auth/email-verify/request", nil, "missing", "s1")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestMFAEnrollUserMissing(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnError(gorm.ErrRecordNotFound)
	w := routedRequest(t, d, http.MethodPost, "/auth/mfa/enroll", nil, "missing", "s1")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestLogoutWithSessionInvokesRevoke(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	w := routedRequest(t, d, http.MethodPost, "/auth/logout", nil, "u1", "s1")
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestMFAVerifyMissingSecret(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	rows := sqlmock.NewRows([]string{"id", "email", "name", "password_hash", "role", "mfa_secret_enc"}).
		AddRow("u1", "u@example.com", "U", "hash", "user", "")
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnRows(rows)
	body, _ := json.Marshal(map[string]any{"code": "123456"})
	w := routedRequest(t, d, http.MethodPost, "/auth/mfa/verify", body, "u1", "s1")
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestMFADisableNotEnabled(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	rows := sqlmock.NewRows([]string{"id", "email", "name", "password_hash", "role", "mfa_enabled"}).
		AddRow("u1", "u@example.com", "U", "hash", "user", false)
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnRows(rows)
	body, _ := json.Marshal(map[string]any{"password": "x"})
	w := routedRequest(t, d, http.MethodPost, "/auth/mfa/disable", body, "u1", "s1")
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}
