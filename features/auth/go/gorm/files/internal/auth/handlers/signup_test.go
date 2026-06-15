package authhandlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"gorm.io/gorm"

	authservice "projx.local/go/internal/auth/service"
)

func hashForTest(pw string) (string, error) {
	return authservice.HashPassword(pw)
}

func TestSignupHappyPath(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	mock.ExpectQuery(`SELECT.*FROM\s+users`).WillReturnError(gorm.ErrRecordNotFound)
	mock.ExpectQuery(`SELECT count\(\*\) FROM\s+users`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO\s+users`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO\s+verification_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	body, _ := json.Marshal(map[string]any{
		"email": "alice@example.com", "name": "Alice", "password": "correct-horse",
	})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/signup", bytes.NewReader(body))
	d.signup(w, r)
	if w.Code != http.StatusCreated {
		t.Logf("body: %s", w.Body.String())
	}
	assert.Equal(t, http.StatusCreated, w.Code)
}

func TestLoginNoMFASuccess(t *testing.T) {
	d, mock, done := newMockDeps(t)
	defer done()
	hash, _ := hashForTest("correct-horse")
	cols := []string{"id", "email", "name", "password_hash", "role", "failed_login_count", "locked_until", "mfa_enabled", "mfa_secret_enc"}
	mock.ExpectQuery(`SELECT.*FROM\s+users`).
		WillReturnRows(sqlmock.NewRows(cols).AddRow("u1", "u@example.com", "U", hash, "user", 0, nil, false, ""))
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+users`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	body, _ := json.Marshal(map[string]any{"email": "u@example.com", "password": "correct-horse"})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewReader(body))
	d.login(w, r)
	if w.Code != http.StatusOK {
		t.Logf("body: %s", w.Body.String())
	}
	assert.Equal(t, http.StatusOK, w.Code)
}
