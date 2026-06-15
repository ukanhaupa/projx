package authcron

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func mockGorm(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, func()) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	require.NoError(t, err)
	gdb, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB, PreferSimpleProtocol: true, WithoutQuotingCheck: true}), &gorm.Config{})
	require.NoError(t, err)
	return gdb, mock, func() { sqlDB.Close() }
}

func TestCleanupRunsBothDeletes(t *testing.T) {
	gdb, mock, done := mockGorm(t)
	defer done()
	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM\s+verification_tokens`).WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectCommit()
	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 5))
	mock.ExpectCommit()
	v, r, err := Cleanup(context.Background(), gdb, time.Now().UTC())
	require.NoError(t, err)
	assert.Equal(t, int64(3), v)
	assert.Equal(t, int64(5), r)
}

func TestCleanupVerificationError(t *testing.T) {
	gdb, mock, done := mockGorm(t)
	defer done()
	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM\s+verification_tokens`).WillReturnError(assertErr())
	mock.ExpectRollback()
	_, _, err := Cleanup(context.Background(), gdb, time.Now().UTC())
	assert.Error(t, err)
}

func assertErr() error { return errBoom }

var errBoom = boomError{}

type boomError struct{}

func (boomError) Error() string { return "boom" }

func TestJobTickAndStop(t *testing.T) {
	t.Setenv("AUTH_BACKGROUND_JOBS", "true")
	t.Setenv("AUTH_CLEANUP_INTERVAL_SECONDS", "3600")
	gdb, mock, done := mockGorm(t)
	defer done()
	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM\s+verification_tokens`).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM\s+refresh_tokens`).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	j := New(gdb)
	ctx, cancel := context.WithCancel(context.Background())
	j.Start(ctx)
	time.Sleep(50 * time.Millisecond)
	cancel()
	j.Stop()
}
