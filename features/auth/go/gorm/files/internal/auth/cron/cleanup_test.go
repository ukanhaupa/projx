package authcron

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	authmodels "projx.local/go/internal/auth/models"
	"projx.local/go/internal/db"
)

func TestIntervalFromEnv(t *testing.T) {
	t.Setenv("AUTH_CLEANUP_INTERVAL_SECONDS", "")
	assert.Equal(t, time.Duration(defaultIntervalSeconds)*time.Second, intervalFromEnv())
	t.Setenv("AUTH_CLEANUP_INTERVAL_SECONDS", "5")
	assert.Equal(t, 5*time.Second, intervalFromEnv())
	t.Setenv("AUTH_CLEANUP_INTERVAL_SECONDS", "bad")
	assert.Equal(t, time.Duration(defaultIntervalSeconds)*time.Second, intervalFromEnv())
	t.Setenv("AUTH_CLEANUP_INTERVAL_SECONDS", "-1")
	assert.Equal(t, time.Duration(defaultIntervalSeconds)*time.Second, intervalFromEnv())
}

func TestEnabledRespectsEnv(t *testing.T) {
	t.Setenv("AUTH_BACKGROUND_JOBS", "")
	assert.True(t, enabled())
	t.Setenv("AUTH_BACKGROUND_JOBS", "false")
	assert.False(t, enabled())
	t.Setenv("AUTH_BACKGROUND_JOBS", "FALSE")
	assert.False(t, enabled())
}

func TestCleanupRemovesExpiredRows(t *testing.T) {
	if testing.Short() || os.Getenv("DATABASE_URL") == "" {
		t.Skip("integration test skipped")
	}
	gdb, err := db.Open(context.Background())
	require.NoError(t, err)
	_ = gdb.Migrator().DropTable(&authmodels.RefreshToken{}, &authmodels.VerificationToken{}, &authmodels.User{})
	require.NoError(t, gdb.AutoMigrate(&authmodels.User{}, &authmodels.RefreshToken{}, &authmodels.VerificationToken{}))

	user := &authmodels.User{Email: "cron@example.com", Name: "C", PasswordHash: "x", Role: "user"}
	require.NoError(t, gdb.Create(user).Error)

	past := time.Now().Add(-time.Hour)
	require.NoError(t, gdb.Create(&authmodels.VerificationToken{
		UserID: user.ID, Kind: "email_verify", TokenHash: "vexp", ExpiresAt: past,
	}).Error)
	require.NoError(t, gdb.Create(&authmodels.RefreshToken{
		UserID: user.ID, SessionID: user.ID, TokenHash: "rexp", ExpiresAt: past,
	}).Error)

	v, r, err := Cleanup(context.Background(), gdb, time.Now().UTC())
	require.NoError(t, err)
	assert.GreaterOrEqual(t, v, int64(1))
	assert.GreaterOrEqual(t, r, int64(1))
}

func TestJobStartDisabledShortCircuits(t *testing.T) {
	t.Setenv("AUTH_BACKGROUND_JOBS", "false")
	j := New(nil)
	j.Start(context.Background())
	j.Stop()
}
