package authhandlers

import (
	"bytes"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"

	authservice "projx.local/go/internal/auth/service"
)

func TestSignupDuplicateEmail(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+users`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "email"}).AddRow("u1", "x@example.com"))
	body, _ := json.Marshal(map[string]any{
		"email": "x@example.com", "name": "X", "password": "12345678",
	})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/signup", bytes.NewReader(body))
	d.signup(w, r)
	assert.Equal(t, http.StatusConflict, w.Code)
}

func TestLoginMFAChallenge(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	hash, _ := authservice.HashPassword("correct-horse")
	cols := []string{"id", "email", "name", "password_hash", "role", "failed_login_count", "locked_until", "mfa_enabled", "mfa_secret_enc"}
	mfaSecret, _ := authservice.GenerateMFASecret()
	enc, _ := authservice.EncodeMFASecret(mfaSecret)
	mock.ExpectQuery(`SELECT.*FROM\s+users`).
		WillReturnRows(sqlmock.NewRows(cols).AddRow("u1", "u@example.com", "U", hash, "user", 0, nil, true, enc))
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+users`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	body, _ := json.Marshal(map[string]any{"email": "u@example.com", "password": "correct-horse"})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewReader(body))
	d.login(w, r)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"mfa_required":true`)
}

func TestLoginWrongPasswordRegistersFailure(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	hash, _ := authservice.HashPassword("correct-horse")
	cols := []string{"id", "email", "name", "password_hash", "role", "failed_login_count", "locked_until"}
	mock.ExpectQuery(`SELECT.*FROM\s+users`).
		WillReturnRows(sqlmock.NewRows(cols).AddRow("u1", "u@example.com", "U", hash, "user", 0, nil))
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+users`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	body, _ := json.Marshal(map[string]any{"email": "u@example.com", "password": "wrong"})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewReader(body))
	d.login(w, r)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestLoginAccountLockedReturnsTooManyRequests(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	future := time.Now().Add(time.Hour)
	cols := []string{"id", "email", "name", "password_hash", "role", "failed_login_count", "locked_until"}
	mock.ExpectQuery(`SELECT.*FROM\s+users`).
		WillReturnRows(sqlmock.NewRows(cols).AddRow("u1", "u@example.com", "U", "h", "user", 5, future))
	body, _ := json.Marshal(map[string]any{"email": "u@example.com", "password": "x"})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewReader(body))
	d.login(w, r)
	assert.Equal(t, http.StatusTooManyRequests, w.Code)
}

func TestPasswordResetRequestHappyPath(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+users`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "email"}).AddRow("u1", "u@example.com"))
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO\s+verification_tokens`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	body, _ := json.Marshal(map[string]any{"email": "u@example.com"})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/password-reset/request", bytes.NewReader(body))
	d.passwordResetRequest(w, r)
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestPasswordResetConfirmHappyPath(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	cols := []string{"id", "user_id", "kind", "token_hash", "expires_at", "consumed_at"}
	rows := sqlmock.NewRows(cols).AddRow("vt1", "u1", "password_reset", "h", time.Now().Add(time.Hour), nil)
	mock.ExpectQuery(`SELECT.*FROM\s+verification_tokens`).WillReturnRows(rows)
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+users`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE\s+verification_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	body, _ := json.Marshal(map[string]any{"token": "raw", "new_password": "new-correct-horse"})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/password-reset/confirm", bytes.NewReader(body))
	d.passwordResetConfirm(w, r)
	if w.Code != http.StatusNoContent {
		t.Logf("body: %s", w.Body.String())
	}
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestEmailVerifyConfirmHappyPath(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	cols := []string{"id", "user_id", "kind", "token_hash", "expires_at"}
	rows := sqlmock.NewRows(cols).AddRow("vt1", "u1", "email_verify", "h", time.Now().Add(time.Hour))
	mock.ExpectQuery(`SELECT.*FROM\s+verification_tokens`).WillReturnRows(rows)
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+users`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE\s+verification_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	body, _ := json.Marshal(map[string]any{"token": "raw"})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/email-verify/confirm", bytes.NewReader(body))
	d.emailVerifyConfirm(w, r)
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestEmailVerifyRequestAlreadyVerified(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	rows := sqlmock.NewRows([]string{"id", "email", "email_verified"}).AddRow("u1", "u@example.com", true)
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnRows(rows)
	w := routedRequest(t, d, http.MethodPost, "/auth/email-verify/request", nil, "u1", "s1")
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestEmailVerifyRequestHappyPath(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	rows := sqlmock.NewRows([]string{"id", "email", "email_verified"}).AddRow("u1", "u@example.com", false)
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnRows(rows)
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO\s+verification_tokens`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	w := routedRequest(t, d, http.MethodPost, "/auth/email-verify/request", nil, "u1", "s1")
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestMFAEnrollHappyPath(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	rows := sqlmock.NewRows([]string{"id", "email", "mfa_enabled"}).AddRow("u1", "u@example.com", false)
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnRows(rows)
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+users`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	w := routedRequest(t, d, http.MethodPost, "/auth/mfa/enroll", nil, "u1", "s1")
	if w.Code != http.StatusOK {
		t.Logf("body: %s", w.Body.String())
	}
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"qrcode_url"`)
}

func TestMFAEnrollConflict(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	rows := sqlmock.NewRows([]string{"id", "email", "mfa_enabled"}).AddRow("u1", "u@example.com", true)
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnRows(rows)
	w := routedRequest(t, d, http.MethodPost, "/auth/mfa/enroll", nil, "u1", "s1")
	assert.Equal(t, http.StatusConflict, w.Code)
}

func TestMFAVerifyInvalidCode(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mfaSecret, _ := authservice.GenerateMFASecret()
	enc, _ := authservice.EncodeMFASecret(mfaSecret)
	cols := []string{"id", "email", "mfa_secret_enc", "mfa_failed_count"}
	rows := sqlmock.NewRows(cols).AddRow("u1", "u@example.com", enc, 0)
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnRows(rows)
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+users`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	body, _ := json.Marshal(map[string]any{"code": "000000"})
	w := routedRequest(t, d, http.MethodPost, "/auth/mfa/verify", body, "u1", "s1")
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestMFADisableInvalidPassword(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	hash, _ := authservice.HashPassword("right")
	cols := []string{"id", "email", "password_hash", "mfa_enabled"}
	rows := sqlmock.NewRows(cols).AddRow("u1", "u@example.com", hash, true)
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnRows(rows)
	body, _ := json.Marshal(map[string]any{"password": "wrong"})
	w := routedRequest(t, d, http.MethodPost, "/auth/mfa/disable", body, "u1", "s1")
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestMFADisableHappyPath(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	hash, _ := authservice.HashPassword("right")
	cols := []string{"id", "email", "password_hash", "mfa_enabled"}
	rows := sqlmock.NewRows(cols).AddRow("u1", "u@example.com", hash, true)
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnRows(rows)
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+users`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	body, _ := json.Marshal(map[string]any{"password": "right"})
	w := routedRequest(t, d, http.MethodPost, "/auth/mfa/disable", body, "u1", "s1")
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestNewDepsConstructsService(t *testing.T) {
	t.Setenv("JWT_SECRET", "x")
	d := NewDeps(nil, nil)
	assert.NotNil(t, d.Validate)
}

var _ = base32.StdEncoding
var _ = binary.BigEndian
