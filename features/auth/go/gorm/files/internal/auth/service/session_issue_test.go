package authservice

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	authmodels "projx.local/go/internal/auth/models"
)

func TestSessionsIssueHappyPath(t *testing.T) {
	t.Setenv("JWT_SECRET", "issue-secret")
	gdb, mock, done := mockGorm(t)
	defer done()
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	s := NewSessions(gdb, NewSigner(nil))
	issued, err := s.Issue(context.Background(), IssueArgs{
		User:      &authmodels.User{ID: "u1", Email: "u@example.com", Name: "U", Role: "user"},
		IPAddress: "1.1.1.1",
		UserAgent: "ua",
	})
	require.NoError(t, err)
	assert.NotEmpty(t, issued.AccessToken)
	assert.NotEmpty(t, issued.RefreshToken)
	assert.NotEmpty(t, issued.SessionID)
}

func TestSessionsRotateUnknownToken(t *testing.T) {
	t.Setenv("JWT_SECRET", "rotate-secret")
	gdb, mock, done := mockGorm(t)
	defer done()
	signer := NewSigner(nil)
	s := NewSessions(gdb, signer)

	pair, err := signer.IssueTokens(context.Background(), TokenPayload{
		Sub: "u1", SID: "s1", Email: "e", Name: "n", Role: "user",
	})
	require.NoError(t, err)

	mock.ExpectQuery(`SELECT.*FROM\s+refresh_tokens`).WillReturnError(authMockError{})
	_, err = s.Rotate(context.Background(), RotateArgs{RefreshToken: pair.RefreshToken})
	assert.ErrorIs(t, err, ErrRefreshInvalid)
}

func TestSessionsRotateExpired(t *testing.T) {
	t.Setenv("JWT_SECRET", "rotate-secret-2")
	gdb, mock, done := mockGorm(t)
	defer done()
	signer := NewSigner(nil)
	s := NewSessions(gdb, signer)
	pair, err := signer.IssueTokens(context.Background(), TokenPayload{
		Sub: "u1", SID: "s1", Email: "e", Name: "n", Role: "user",
	})
	require.NoError(t, err)
	cols := []string{"id", "user_id", "session_id", "token_hash", "expires_at", "revoked_at", "rotated_to"}
	rows := sqlmock.NewRows(cols).AddRow("rt1", "u1", "s1", HashToken(pair.RefreshToken), time.Now().Add(-time.Hour), nil, nil)
	mock.ExpectQuery(`SELECT.*FROM\s+refresh_tokens`).WillReturnRows(rows)
	_, err = s.Rotate(context.Background(), RotateArgs{RefreshToken: pair.RefreshToken})
	assert.ErrorIs(t, err, ErrRefreshInvalid)
}

func TestSessionsRotateReplayDetection(t *testing.T) {
	t.Setenv("JWT_SECRET", "rotate-secret-3")
	gdb, mock, done := mockGorm(t)
	defer done()
	signer := NewSigner(nil)
	s := NewSessions(gdb, signer)
	pair, err := signer.IssueTokens(context.Background(), TokenPayload{
		Sub: "u1", SID: "s1", Email: "e", Name: "n", Role: "user",
	})
	require.NoError(t, err)
	revoked := time.Now().Add(-time.Minute)
	cols := []string{"id", "user_id", "session_id", "token_hash", "expires_at", "revoked_at", "rotated_to"}
	rows := sqlmock.NewRows(cols).AddRow("rt1", "u1", "s1", HashToken(pair.RefreshToken), time.Now().Add(time.Hour), revoked, nil)
	mock.ExpectQuery(`SELECT.*FROM\s+refresh_tokens`).WillReturnRows(rows)
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	_, err = s.Rotate(context.Background(), RotateArgs{RefreshToken: pair.RefreshToken})
	assert.ErrorIs(t, err, ErrReplayDetected)
}

type authMockError struct{}

func (authMockError) Error() string { return "mocked" }
