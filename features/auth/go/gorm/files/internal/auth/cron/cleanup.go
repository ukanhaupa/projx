package authcron

import (
	"context"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	authmodels "projx.local/go/internal/auth/models"
)

const (
	defaultIntervalSeconds = 24 * 60 * 60
	revokedRetentionDays   = 30
)

type Job struct {
	db       *gorm.DB
	interval time.Duration
	stopCh   chan struct{}
	done     chan struct{}
}

func New(db *gorm.DB) *Job {
	return &Job{
		db:       db,
		interval: intervalFromEnv(),
		stopCh:   make(chan struct{}),
		done:     make(chan struct{}),
	}
}

func intervalFromEnv() time.Duration {
	raw := strings.TrimSpace(os.Getenv("AUTH_CLEANUP_INTERVAL_SECONDS"))
	if raw == "" {
		return defaultIntervalSeconds * time.Second
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v <= 0 {
		return defaultIntervalSeconds * time.Second
	}
	return time.Duration(v) * time.Second
}

func enabled() bool {
	return !strings.EqualFold(strings.TrimSpace(os.Getenv("AUTH_BACKGROUND_JOBS")), "false")
}

func (j *Job) Start(ctx context.Context) {
	if !enabled() {
		close(j.done)
		return
	}
	go j.run(ctx)
}

func (j *Job) Stop() {
	select {
	case <-j.stopCh:
	default:
		close(j.stopCh)
	}
	<-j.done
}

func (j *Job) run(ctx context.Context) {
	defer close(j.done)
	ticker := time.NewTicker(j.interval)
	defer ticker.Stop()
	j.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-j.stopCh:
			return
		case <-ticker.C:
			j.tick(ctx)
		}
	}
}

func (j *Job) tick(ctx context.Context) {
	v, r, err := Cleanup(ctx, j.db, time.Now().UTC())
	if err != nil {
		slog.Error("[cleanup] auth artifacts cleanup failed", "err", err)
		return
	}
	if v > 0 || r > 0 {
		slog.Info("[cleanup] auth artifacts cleaned up", "expired_verification_tokens", v, "expired_refresh_tokens", r)
	}
}

func Cleanup(ctx context.Context, db *gorm.DB, now time.Time) (int64, int64, error) {
	cutoff := now.Add(-time.Duration(revokedRetentionDays) * 24 * time.Hour)
	vRes := db.WithContext(ctx).Unscoped().
		Where("expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)", now, cutoff).
		Delete(&authmodels.VerificationToken{})
	if vRes.Error != nil {
		return 0, 0, vRes.Error
	}
	rRes := db.WithContext(ctx).Unscoped().
		Where("expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)", now, cutoff).
		Delete(&authmodels.RefreshToken{})
	if rRes.Error != nil {
		return vRes.RowsAffected, 0, rRes.Error
	}
	return vRes.RowsAffected, rRes.RowsAffected, nil
}
