package authhandlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	authservice "projx.local/go/internal/auth/service"
)

func TestRefreshHappyPath(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	pair, err := d.Signer.IssueTokens(context.Background(), authservice.TokenPayload{
		Sub: "u1", SID: "s1", Email: "u@example.com", Name: "U", Role: "user",
	})
	require.NoError(t, err)
	cols := []string{"id", "user_id", "session_id", "token_hash", "expires_at", "revoked_at", "rotated_to"}
	rows := sqlmock.NewRows(cols).AddRow("rt1", "u1", "s1", authservice.HashToken(pair.RefreshToken), time.Now().Add(time.Hour), nil, nil)
	mock.ExpectQuery(`SELECT.*FROM\s+refresh_tokens`).WillReturnRows(rows)
	userRows := sqlmock.NewRows([]string{"id", "email", "name", "role"}).AddRow("u1", "u@example.com", "U", "user")
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnRows(userRows)
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	body, _ := json.Marshal(map[string]any{"refresh_token": pair.RefreshToken})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/refresh", bytes.NewReader(body))
	d.refresh(w, r)
	if w.Code != http.StatusOK {
		t.Logf("body: %s", w.Body.String())
	}
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRefreshReplayDetected(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	pair, err := d.Signer.IssueTokens(context.Background(), authservice.TokenPayload{
		Sub: "u1", SID: "s1", Email: "u@example.com", Name: "U", Role: "user",
	})
	require.NoError(t, err)
	revoked := time.Now().Add(-time.Minute)
	cols := []string{"id", "user_id", "session_id", "token_hash", "expires_at", "revoked_at", "rotated_to"}
	rows := sqlmock.NewRows(cols).AddRow("rt1", "u1", "s1", authservice.HashToken(pair.RefreshToken), time.Now().Add(time.Hour), revoked, nil)
	mock.ExpectQuery(`SELECT.*FROM\s+refresh_tokens`).WillReturnRows(rows)
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	body, _ := json.Marshal(map[string]any{"refresh_token": pair.RefreshToken})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/refresh", bytes.NewReader(body))
	d.refresh(w, r)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestRefreshRotationGrace(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	pair, err := d.Signer.IssueTokens(context.Background(), authservice.TokenPayload{
		Sub: "u1", SID: "s1", Email: "u@example.com", Name: "U", Role: "user",
	})
	require.NoError(t, err)
	rotatedTo := "rt2"
	cols := []string{"id", "user_id", "session_id", "token_hash", "expires_at", "revoked_at", "rotated_to", "replay_detected_at"}
	presented := sqlmock.NewRows(cols).AddRow(
		"rt1", "u1", "s1", authservice.HashToken(pair.RefreshToken),
		time.Now().Add(time.Hour), time.Now().Add(-time.Minute), rotatedTo, nil,
	)
	mock.ExpectQuery(`SELECT.*FROM\s+refresh_tokens`).WillReturnRows(presented)
	child := sqlmock.NewRows(cols).AddRow(
		"rt2", "u1", "s1", "child-hash",
		time.Now().Add(time.Hour), nil, nil, nil,
	)
	mock.ExpectQuery(`SELECT.*FROM\s+refresh_tokens`).WillReturnRows(child)
	userRows := sqlmock.NewRows([]string{"id", "email", "name", "role"}).AddRow("u1", "u@example.com", "U", "user")
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnRows(userRows)
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	body, _ := json.Marshal(map[string]any{"refresh_token": pair.RefreshToken})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/refresh", bytes.NewReader(body))
	d.refresh(w, r)
	if w.Code != http.StatusOK {
		t.Logf("body: %s", w.Body.String())
	}
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestPasswordResetRequestDBError(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnError(errors.New("boom"))
	body, _ := json.Marshal(map[string]any{"email": "u@example.com"})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/password-reset/request", bytes.NewReader(body))
	d.passwordResetRequest(w, r)
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestMFAVerifyInvalidBody(t *testing.T) {
	d, _, done := newMockDeps(t)
	defer done()
	body, _ := json.Marshal(map[string]any{})
	w := routedRequest(t, d, http.MethodPost, "/auth/mfa/verify", body, "u1", "s1")
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestPasswordResetConfirmInvalidBody(t *testing.T) {
	d, _, done := newMockDeps(t)
	defer done()
	body, _ := json.Marshal(map[string]any{"token": ""})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/password-reset/confirm", bytes.NewReader(body))
	d.passwordResetConfirm(w, r)
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestSignupValidationFailsShortPassword(t *testing.T) {
	d, _, done := newMockDeps(t)
	defer done()
	body, _ := json.Marshal(map[string]any{"email": "x@example.com", "name": "X", "password": "1"})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/signup", bytes.NewReader(body))
	d.signup(w, r)
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestSignupDBErrorReturns500(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnError(errors.New("boom"))
	body, _ := json.Marshal(map[string]any{
		"email": "x@example.com", "name": "X", "password": "12345678",
	})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/signup", bytes.NewReader(body))
	d.signup(w, r)
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestLoginDBLookupError(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnError(errors.New("boom"))
	body, _ := json.Marshal(map[string]any{"email": "x@example.com", "password": "any"})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewReader(body))
	d.login(w, r)
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestEmailVerifyRequestAlreadyVerifiedShortCircuits(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	rows := sqlmock.NewRows([]string{"id", "email", "email_verified"}).AddRow("u1", "u@example.com", true)
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnRows(rows)
	w := routedRequest(t, d, http.MethodPost, "/auth/email-verify/request", nil, "u1", "s1")
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestEmailVerifyConfirmDBError(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+verification_tokens`).WillReturnError(errors.New("boom"))
	body, _ := json.Marshal(map[string]any{"token": "raw"})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/email-verify/confirm", bytes.NewReader(body))
	d.emailVerifyConfirm(w, r)
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestPasswordResetConfirmDBError(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+verification_tokens`).WillReturnError(errors.New("boom"))
	body, _ := json.Marshal(map[string]any{"token": "raw", "new_password": "12345678"})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/password-reset/confirm", bytes.NewReader(body))
	d.passwordResetConfirm(w, r)
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestMFAEnrollUserDBError(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnError(errors.New("boom"))
	w := routedRequest(t, d, http.MethodPost, "/auth/mfa/enroll", nil, "u1", "s1")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestMFAVerifyUserDBError(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnError(errors.New("boom"))
	body, _ := json.Marshal(map[string]any{"code": "123456"})
	w := routedRequest(t, d, http.MethodPost, "/auth/mfa/verify", body, "u1", "s1")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestMFADisableUserMissing(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnError(errors.New("boom"))
	body, _ := json.Marshal(map[string]any{"password": "x"})
	w := routedRequest(t, d, http.MethodPost, "/auth/mfa/disable", body, "u1", "s1")
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestPasswordResetConfirmInvalidNewPassword(t *testing.T) {
	d, _, done := newMockDeps(t)
	defer done()
	body, _ := json.Marshal(map[string]any{"token": "x", "new_password": "short"})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/password-reset/confirm", bytes.NewReader(body))
	d.passwordResetConfirm(w, r)
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}
