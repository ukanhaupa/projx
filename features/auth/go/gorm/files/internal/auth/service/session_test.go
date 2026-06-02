package authservice

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	authmodels "projx.local/go/internal/auth/models"
)

func mockGorm(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, func()) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	require.NoError(t, err)
	gdb, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB, PreferSimpleProtocol: true, WithoutQuotingCheck: true}), &gorm.Config{})
	require.NoError(t, err)
	return gdb, mock, func() { sqlDB.Close() }
}

func TestIsAccountLocked(t *testing.T) {
	assert.False(t, IsAccountLocked(&authmodels.User{}))
	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)
	assert.False(t, IsAccountLocked(&authmodels.User{LockedUntil: &past}))
	assert.True(t, IsAccountLocked(&authmodels.User{LockedUntil: &future}))
}

func TestRegisterFailedLoginLocksAfterMax(t *testing.T) {
	gdb, mock, done := mockGorm(t)
	defer done()
	user := &authmodels.User{ID: "u1", FailedLoginCount: LoginMaxAttempts - 1}
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+users`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	require.NoError(t, RegisterFailedLogin(gdb, context.Background(), user))
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestResetLoginCounters(t *testing.T) {
	gdb, mock, done := mockGorm(t)
	defer done()
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+users`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	require.NoError(t, ResetLoginCounters(gdb, context.Background(), "u1"))
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRegisterMFAFailureLocksAfterMax(t *testing.T) {
	gdb, mock, done := mockGorm(t)
	defer done()
	user := &authmodels.User{ID: "u1", MFAFailedCount: MFAMaxAttempts - 1}
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+users`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	require.NoError(t, RegisterMFAFailure(gdb, context.Background(), user))
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestResetMFACounters(t *testing.T) {
	gdb, mock, done := mockGorm(t)
	defer done()
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+users`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	require.NoError(t, ResetMFACounters(gdb, context.Background(), "u1"))
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSessionsIssueNilUser(t *testing.T) {
	t.Setenv("JWT_SECRET", "x")
	gdb, _, done := mockGorm(t)
	defer done()
	s := NewSessions(gdb, NewSigner(nil))
	_, err := s.Issue(context.Background(), IssueArgs{})
	assert.ErrorIs(t, err, ErrUserMissing)
}

func TestSessionsRotateInvalidToken(t *testing.T) {
	t.Setenv("JWT_SECRET", "x")
	gdb, _, done := mockGorm(t)
	defer done()
	s := NewSessions(gdb, NewSigner(nil))
	_, err := s.Rotate(context.Background(), RotateArgs{RefreshToken: "not.a.jwt"})
	assert.ErrorIs(t, err, ErrRefreshInvalid)
}

func TestSessionsRevokeAllForUser(t *testing.T) {
	gdb, mock, done := mockGorm(t)
	defer done()
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+refresh_tokens`).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectCommit()
	s := NewSessions(gdb, NewSigner(nil))
	require.NoError(t, s.RevokeAllForUser(context.Background(), "u1"))
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSessionsRevokeSession(t *testing.T) {
	gdb, mock, done := mockGorm(t)
	defer done()
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE\s+refresh_tokens`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	s := NewSessions(gdb, NewSigner(nil))
	require.NoError(t, s.RevokeSession(context.Background(), "u1", "sess1"))
	assert.NoError(t, mock.ExpectationsWereMet())
}
