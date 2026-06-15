package authhandlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth/mailer"
	authservice "projx.local/go/internal/auth/service"
)

func newMockDeps(t *testing.T) (*Deps, sqlmock.Sqlmock, func()) {
	t.Helper()
	t.Setenv("JWT_SECRET", "test-secret")
	sqlDB, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	require.NoError(t, err)
	gdb, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB, PreferSimpleProtocol: true, WithoutQuotingCheck: true}), &gorm.Config{})
	require.NoError(t, err)
	signer := authservice.NewSigner(nil)
	d := &Deps{
		DB:       gdb,
		Signer:   signer,
		Sessions: authservice.NewSessions(gdb, signer),
		Mailer:   mailer.New(nil),
		Validate: validator.New(validator.WithRequiredStructEnabled()),
	}
	require.NoError(t, d.Mailer.Load(nil))
	return d, mock, func() { sqlDB.Close() }
}

func TestRoutesShapeAuthedAndPublic(t *testing.T) {
	d, _, done := newMockDeps(t)
	defer done()
	h := Routes(d, nil)
	require.NotNil(t, h)
	_, ok := h.(chi.Router)
	assert.True(t, ok)
}

func TestSignupRejectsInvalidBody(t *testing.T) {
	d, _, done := newMockDeps(t)
	defer done()
	req := httptest.NewRequest(http.MethodPost, "/auth/signup", strings.NewReader("garbage"))
	w := httptest.NewRecorder()
	d.signup(w, req)
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestSignupRejectsMissingFields(t *testing.T) {
	d, _, done := newMockDeps(t)
	defer done()
	buf, _ := json.Marshal(map[string]any{"email": "bad", "name": "", "password": "short"})
	req := httptest.NewRequest(http.MethodPost, "/auth/signup", bytes.NewReader(buf))
	w := httptest.NewRecorder()
	d.signup(w, req)
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestLoginRejectsInvalidBody(t *testing.T) {
	d, _, done := newMockDeps(t)
	defer done()
	req := httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader("not-json"))
	w := httptest.NewRecorder()
	d.login(w, req)
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestLoginUnknownUserReturns401(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+users`).
		WillReturnError(gorm.ErrRecordNotFound)
	buf, _ := json.Marshal(map[string]any{"email": "u@x.com", "password": "irrelevant"})
	req := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewReader(buf))
	w := httptest.NewRecorder()
	d.login(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestRefreshRejectsInvalidJWT(t *testing.T) {
	d, _, done := newMockDeps(t)
	defer done()
	buf, _ := json.Marshal(map[string]any{"refresh_token": "not.a.jwt"})
	req := httptest.NewRequest(http.MethodPost, "/auth/refresh", bytes.NewReader(buf))
	w := httptest.NewRecorder()
	d.refresh(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestRefreshRejectsBadBody(t *testing.T) {
	d, _, done := newMockDeps(t)
	defer done()
	req := httptest.NewRequest(http.MethodPost, "/auth/refresh", strings.NewReader("{"))
	w := httptest.NewRecorder()
	d.refresh(w, req)
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestPasswordResetConfirmRejectsMissingToken(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+verification_tokens`).WillReturnError(gorm.ErrRecordNotFound)
	buf, _ := json.Marshal(map[string]any{"token": "missing", "new_password": "super-secret"})
	req := httptest.NewRequest(http.MethodPost, "/auth/password-reset/confirm", bytes.NewReader(buf))
	w := httptest.NewRecorder()
	d.passwordResetConfirm(w, req)
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestPasswordResetRequestMissingUserReturnsNoContent(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnError(gorm.ErrRecordNotFound)
	buf, _ := json.Marshal(map[string]any{"email": "absent@example.com"})
	req := httptest.NewRequest(http.MethodPost, "/auth/password-reset/request", bytes.NewReader(buf))
	w := httptest.NewRecorder()
	d.passwordResetRequest(w, req)
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestEmailVerifyConfirmRejectsBadToken(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+verification_tokens`).WillReturnError(gorm.ErrRecordNotFound)
	buf, _ := json.Marshal(map[string]any{"token": "missing"})
	req := httptest.NewRequest(http.MethodPost, "/auth/email-verify/confirm", bytes.NewReader(buf))
	w := httptest.NewRecorder()
	d.emailVerifyConfirm(w, req)
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestNewDepsConstructsAll(t *testing.T) {
	d, _, done := newMockDeps(t)
	defer done()
	assert.NotNil(t, d.Signer)
	assert.NotNil(t, d.Sessions)
	assert.NotNil(t, d.Mailer)
	assert.NotNil(t, d.Validate)
}

func TestClientIPAndUserAgent(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 5.6.7.8")
	req.Header.Set("User-Agent", "ua")
	assert.Equal(t, "1.2.3.4", clientIP(req))
	assert.Equal(t, "ua", userAgent(req))

	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.RemoteAddr = "10.0.0.1:1234"
	assert.Equal(t, "10.0.0.1:1234", clientIP(req2))
}

func TestHumanizeValidationFallback(t *testing.T) {
	out := humanizeValidation(errors.New("plain"))
	assert.Equal(t, "plain", out)
}

func TestWriteJSONStatusBody(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusTeapot, map[string]string{"hello": "world"})
	assert.Equal(t, http.StatusTeapot, w.Code)
	assert.Contains(t, w.Body.String(), `"hello":"world"`)
	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
}

func TestApperrIntegration(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	apperr.WriteError(w, req, apperr.Unauthorized("nope"))
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
