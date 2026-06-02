package cron

import (
	"context"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	authservice "projx.local/go/internal/auth/service"
)

const defaultIntervalSeconds = 3600

func intervalSeconds() int {
	v := os.Getenv("AUTH_CLEANUP_INTERVAL_SECONDS")
	if v == "" {
		return defaultIntervalSeconds
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return defaultIntervalSeconds
	}
	return n
}

func enabled() bool {
	v := os.Getenv("AUTH_BACKGROUND_JOBS")
	if v == "" {
		return true
	}
	v = strings.ToLower(strings.TrimSpace(v))
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

func Start(ctx context.Context, q authservice.Querier) {
	if !enabled() {
		slog.Info("auth cleanup disabled (AUTH_BACKGROUND_JOBS)")
		return
	}
	interval := time.Duration(intervalSeconds()) * time.Second
	t := time.NewTicker(interval)
	go func() {
		defer t.Stop()
		runOnce(ctx, q)
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				runOnce(ctx, q)
			}
		}
	}()
}

func runOnce(ctx context.Context, q authservice.Querier) {
	if err := q.DeleteExpiredSessions(ctx); err != nil {
		slog.Warn("auth cleanup: sessions", "error", err)
	}
	if err := q.DeleteExpiredPasswordResetTokens(ctx); err != nil {
		slog.Warn("auth cleanup: password reset tokens", "error", err)
	}
	if err := q.DeleteExpiredEmailVerifyTokens(ctx); err != nil {
		slog.Warn("auth cleanup: email verify tokens", "error", err)
	}
}
