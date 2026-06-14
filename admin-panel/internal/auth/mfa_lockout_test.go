package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"
)

func enrolledMFAStore(t *testing.T) (*Store, int64, string) {
	t.Helper()
	store, _, id := mfaTestStore(t)
	ctx := context.Background()
	enrollment, err := store.BeginEnrollment(ctx, id)
	if err != nil {
		t.Fatalf("BeginEnrollment: %v", err)
	}
	code, err := totp.GenerateCode(enrollment.Secret, nowUTC())
	if err != nil {
		t.Fatalf("GenerateCode: %v", err)
	}
	if err := store.CompleteEnrollment(ctx, id, enrollment.Secret, enrollment.RecoveryCodes, code); err != nil {
		t.Fatalf("CompleteEnrollment: %v", err)
	}
	return store, id, enrollment.Secret
}

func TestChallengeLocksAfterMaxFailures(t *testing.T) {
	store, id, secret := enrolledMFAStore(t)
	ctx := context.Background()

	for i := 0; i < mfaMaxAttempts; i++ {
		ok, err := store.VerifyMFAChallenge(ctx, id, "000000")
		if err != nil {
			t.Fatalf("attempt %d: unexpected error %v", i, err)
		}
		if ok {
			t.Fatalf("attempt %d with a wrong code must not verify", i)
		}
	}

	good, _ := totp.GenerateCode(secret, nowUTC())
	ok, err := store.VerifyMFAChallenge(ctx, id, good)
	if !errors.Is(err, ErrMFALocked) {
		t.Fatalf("after %d failures even a correct code must be rejected as locked, got ok=%v err=%v", mfaMaxAttempts, ok, err)
	}
	if ok {
		t.Fatal("a locked account must not verify even with the correct code")
	}
}

func TestChallengeSuccessResetsCounter(t *testing.T) {
	store, id, secret := enrolledMFAStore(t)
	ctx := context.Background()

	for i := 0; i < mfaMaxAttempts-1; i++ {
		if _, err := store.VerifyMFAChallenge(ctx, id, "000000"); err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}

	good, _ := totp.GenerateCode(secret, nowUTC())
	ok, err := store.VerifyMFAChallenge(ctx, id, good)
	if err != nil {
		t.Fatalf("valid code below the threshold must verify: %v", err)
	}
	if !ok {
		t.Fatal("a correct code below the lockout threshold must verify")
	}

	var attempts int
	if err := store.pool.QueryRow(ctx,
		`SELECT mfa_failed_attempts FROM admin_panel.admin_users WHERE id=$1`, id,
	).Scan(&attempts); err != nil {
		t.Fatalf("read counter: %v", err)
	}
	if attempts != 0 {
		t.Fatalf("a successful verification must reset the failure counter to 0, got %d", attempts)
	}
}

func TestChallengeLockoutExpires(t *testing.T) {
	store, id, secret := enrolledMFAStore(t)
	ctx := context.Background()

	for i := 0; i < mfaMaxAttempts; i++ {
		if _, err := store.VerifyMFAChallenge(ctx, id, "000000"); err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}

	if _, err := store.pool.Exec(ctx,
		`UPDATE admin_panel.admin_users SET mfa_locked_until = NOW() - INTERVAL '1 minute' WHERE id=$1`, id,
	); err != nil {
		t.Fatalf("expire lock: %v", err)
	}

	good, _ := totp.GenerateCode(secret, nowUTC())
	ok, err := store.VerifyMFAChallenge(ctx, id, good)
	if err != nil {
		t.Fatalf("after the lock window expires a correct code must verify: %v", err)
	}
	if !ok {
		t.Fatal("a correct code must verify once the lockout window has elapsed")
	}
}

func TestChallengeLockSetsWindow(t *testing.T) {
	store, id, _ := enrolledMFAStore(t)
	ctx := context.Background()

	before := time.Now()
	for i := 0; i < mfaMaxAttempts; i++ {
		if _, err := store.VerifyMFAChallenge(ctx, id, "000000"); err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}

	var lockedUntil *time.Time
	if err := store.pool.QueryRow(ctx,
		`SELECT mfa_locked_until FROM admin_panel.admin_users WHERE id=$1`, id,
	).Scan(&lockedUntil); err != nil {
		t.Fatalf("read lock: %v", err)
	}
	if lockedUntil == nil {
		t.Fatal("reaching the attempt ceiling must set mfa_locked_until")
	}
	expected := before.Add(mfaLockWindow)
	if lockedUntil.Before(expected.Add(-time.Minute)) || lockedUntil.After(expected.Add(time.Minute)) {
		t.Fatalf("mfa_locked_until should be ~now+%s, got %v (expected ~%v)", mfaLockWindow, lockedUntil, expected)
	}
}

func TestChallengeRecoveryCodeFailuresCountTowardLock(t *testing.T) {
	store, id, secret := enrolledMFAStore(t)
	ctx := context.Background()

	for i := 0; i < mfaMaxAttempts; i++ {
		ok, err := store.VerifyMFAChallenge(ctx, id, "WRONGRECOVERYCODE")
		if err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
		if ok {
			t.Fatalf("attempt %d: a bogus recovery code must not verify", i)
		}
	}

	good, _ := totp.GenerateCode(secret, nowUTC())
	_, err := store.VerifyMFAChallenge(ctx, id, good)
	if !errors.Is(err, ErrMFALocked) {
		t.Fatalf("failed recovery-code attempts must count toward the lockout, got err=%v", err)
	}
}

func TestChallengeLockedErrorDoesNotRevealCorrectness(t *testing.T) {
	store, id, secret := enrolledMFAStore(t)
	ctx := context.Background()

	for i := 0; i < mfaMaxAttempts; i++ {
		if _, err := store.VerifyMFAChallenge(ctx, id, "000000"); err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}

	good, _ := totp.GenerateCode(secret, nowUTC())
	_, errCorrect := store.VerifyMFAChallenge(ctx, id, good)
	_, errWrong := store.VerifyMFAChallenge(ctx, id, "111111")

	if !errors.Is(errCorrect, ErrMFALocked) || !errors.Is(errWrong, ErrMFALocked) {
		t.Fatalf("while locked, both correct and wrong codes must return ErrMFALocked; correct=%v wrong=%v", errCorrect, errWrong)
	}
	if errCorrect.Error() != errWrong.Error() {
		t.Fatal("the locked error must be identical regardless of code correctness")
	}
}
