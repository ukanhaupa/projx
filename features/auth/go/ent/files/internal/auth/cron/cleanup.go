package cron

import (
	"context"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"projx.local/go/ent"
	"projx.local/go/ent/emailverifytoken"
	"projx.local/go/ent/passwordresettoken"
	"projx.local/go/ent/session"
)

const (
	defaultIntervalSeconds = 3600
	revokedRetentionDays   = 30
)

type CleanupResult struct {
	PasswordResetTokens int
	EmailVerifyTokens   int
	Sessions            int
}

func cleanup(ctx context.Context, client *ent.Client, now time.Time) (CleanupResult, error) {
	cutoff := now.Add(-time.Duration(revokedRetentionDays) * 24 * time.Hour)

	prCount, err := client.PasswordResetToken.Delete().Where(
		passwordresettoken.Or(
			passwordresettoken.ExpiresAtLT(now),
			passwordresettoken.And(
				passwordresettoken.ConsumedAtNotNil(),
				passwordresettoken.ConsumedAtLT(cutoff),
			),
		),
	).Exec(ctx)
	if err != nil {
		return CleanupResult{}, err
	}

	evCount, err := client.EmailVerifyToken.Delete().Where(
		emailverifytoken.Or(
			emailverifytoken.ExpiresAtLT(now),
			emailverifytoken.And(
				emailverifytoken.ConsumedAtNotNil(),
				emailverifytoken.ConsumedAtLT(cutoff),
			),
		),
	).Exec(ctx)
	if err != nil {
		return CleanupResult{}, err
	}

	sCount, err := client.Session.Delete().Where(
		session.Or(
			session.ExpiresAtLT(now),
			session.And(
				session.RevokedAtNotNil(),
				session.RevokedAtLT(cutoff),
			),
		),
	).Exec(ctx)
	if err != nil {
		return CleanupResult{}, err
	}

	return CleanupResult{
		PasswordResetTokens: prCount,
		EmailVerifyTokens:   evCount,
		Sessions:            sCount,
	}, nil
}

func RunOnce(ctx context.Context, client *ent.Client) (CleanupResult, error) {
	return cleanup(ctx, client, time.Now())
}

func Start(ctx context.Context, client *ent.Client, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}
	if strings.EqualFold(os.Getenv("AUTH_BACKGROUND_JOBS"), "false") {
		logger.Info("[auth cleanup] disabled by AUTH_BACKGROUND_JOBS=false")
		return
	}
	interval := defaultIntervalSeconds
	if raw := strings.TrimSpace(os.Getenv("AUTH_CLEANUP_INTERVAL_SECONDS")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			interval = n
		}
	}
	ticker := time.NewTicker(time.Duration(interval) * time.Second)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				res, err := cleanup(ctx, client, time.Now())
				if err != nil {
					logger.Error("[auth cleanup] failed", "error", err.Error())
					continue
				}
				if res.PasswordResetTokens+res.EmailVerifyTokens+res.Sessions > 0 {
					logger.Info("[auth cleanup] removed",
						"password_reset_tokens", res.PasswordResetTokens,
						"email_verify_tokens", res.EmailVerifyTokens,
						"sessions", res.Sessions,
					)
				}
			}
		}
	}()
}
