package auth

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pquerna/otp/totp"

	"adminpanel/internal/db"
	"adminpanel/internal/testenv"
)

func mfaTestStore(t *testing.T) (*Store, *pgxpool.Pool, int64) {
	t.Helper()
	dsn := testenv.DatabaseURL()
	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `DROP SCHEMA IF EXISTS admin_panel CASCADE`); err != nil {
		t.Fatalf("reset: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DROP SCHEMA IF EXISTS admin_panel CASCADE`)
	})
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	store := NewStore(pool, "unit-test-session-secret-0123456789ab")
	if err := store.EnsureBootstrap(ctx, "admin@example.com", "s3cret-pass1"); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	var id int64
	if err := pool.QueryRow(ctx, `SELECT id FROM admin_panel.admin_users WHERE email='admin@example.com'`).Scan(&id); err != nil {
		t.Fatalf("admin id: %v", err)
	}
	return store, pool, id
}

func TestBootstrapAdminNotEnrolled(t *testing.T) {
	store, _, id := mfaTestStore(t)
	ctx := context.Background()
	enrolled, err := store.MFAEnrolled(ctx, id)
	if err != nil {
		t.Fatalf("MFAEnrolled: %v", err)
	}
	if enrolled {
		t.Fatal("freshly bootstrapped admin must not be pre-enrolled in 2FA")
	}
}

func TestEnrollGeneratesSecretAndRecoveryCodes(t *testing.T) {
	store, _, id := mfaTestStore(t)
	ctx := context.Background()
	enrollment, err := store.BeginEnrollment(ctx, id)
	if err != nil {
		t.Fatalf("BeginEnrollment: %v", err)
	}
	if enrollment.Secret == "" || enrollment.OTPAuthURL == "" {
		t.Fatal("enrollment must yield a secret and an otpauth provisioning URL")
	}
	if len(enrollment.RecoveryCodes) == 0 {
		t.Fatal("enrollment must issue plaintext recovery codes shown once")
	}
}

func TestCompleteEnrollmentRequiresValidCode(t *testing.T) {
	store, _, id := mfaTestStore(t)
	ctx := context.Background()
	enrollment, err := store.BeginEnrollment(ctx, id)
	if err != nil {
		t.Fatalf("BeginEnrollment: %v", err)
	}

	if err := store.CompleteEnrollment(ctx, id, enrollment.Secret, enrollment.RecoveryCodes, "000000"); err == nil {
		t.Fatal("completing enrollment with a wrong code must fail")
	}
	enrolled, _ := store.MFAEnrolled(ctx, id)
	if enrolled {
		t.Fatal("a failed verification must NOT persist enrollment")
	}

	code, err := totp.GenerateCode(enrollment.Secret, nowUTC())
	if err != nil {
		t.Fatalf("GenerateCode: %v", err)
	}
	if err := store.CompleteEnrollment(ctx, id, enrollment.Secret, enrollment.RecoveryCodes, code); err != nil {
		t.Fatalf("CompleteEnrollment with valid code: %v", err)
	}
	enrolled, _ = store.MFAEnrolled(ctx, id)
	if !enrolled {
		t.Fatal("enrollment must persist after a valid first code")
	}
}

func TestSecretStoredEncrypted(t *testing.T) {
	store, pool, id := mfaTestStore(t)
	ctx := context.Background()
	enrollment, _ := store.BeginEnrollment(ctx, id)
	code, _ := totp.GenerateCode(enrollment.Secret, nowUTC())
	if err := store.CompleteEnrollment(ctx, id, enrollment.Secret, enrollment.RecoveryCodes, code); err != nil {
		t.Fatalf("complete: %v", err)
	}
	var stored string
	if err := pool.QueryRow(ctx, `SELECT totp_secret_enc FROM admin_panel.admin_users WHERE id=$1`, id).Scan(&stored); err != nil {
		t.Fatalf("read stored secret: %v", err)
	}
	if stored == "" {
		t.Fatal("expected a stored encrypted secret")
	}
	if stored == enrollment.Secret {
		t.Fatal("TOTP secret must NOT be stored in plaintext")
	}
}

func TestVerifyTOTPAfterEnrollment(t *testing.T) {
	store, _, id := mfaTestStore(t)
	ctx := context.Background()
	enrollment, _ := store.BeginEnrollment(ctx, id)
	code, _ := totp.GenerateCode(enrollment.Secret, nowUTC())
	if err := store.CompleteEnrollment(ctx, id, enrollment.Secret, enrollment.RecoveryCodes, code); err != nil {
		t.Fatalf("complete: %v", err)
	}

	good, _ := totp.GenerateCode(enrollment.Secret, nowUTC())
	ok, err := store.VerifyMFA(ctx, id, good)
	if err != nil {
		t.Fatalf("VerifyMFA: %v", err)
	}
	if !ok {
		t.Fatal("a valid TOTP code should verify after enrollment")
	}

	ok, _ = store.VerifyMFA(ctx, id, "000000")
	if ok {
		t.Fatal("a wrong TOTP code must be rejected")
	}
}

func TestVerifyMFAFalseWhenNotEnrolled(t *testing.T) {
	store, _, id := mfaTestStore(t)
	ctx := context.Background()
	ok, err := store.VerifyMFA(ctx, id, "123456")
	if err != nil {
		t.Fatalf("VerifyMFA: %v", err)
	}
	if ok {
		t.Fatal("verification must fail for an admin that has not enrolled")
	}
}

func TestMarkSessionMFAPassedUnknownToken(t *testing.T) {
	store, _, _ := mfaTestStore(t)
	if err := store.MarkSessionMFAPassed(context.Background(), "nonexistent-token"); err == nil {
		t.Fatal("marking an unknown session must error")
	}
}

func TestRecoveryCodeSingleUse(t *testing.T) {
	store, _, id := mfaTestStore(t)
	ctx := context.Background()
	enrollment, _ := store.BeginEnrollment(ctx, id)
	code, _ := totp.GenerateCode(enrollment.Secret, nowUTC())
	if err := store.CompleteEnrollment(ctx, id, enrollment.Secret, enrollment.RecoveryCodes, code); err != nil {
		t.Fatalf("complete: %v", err)
	}

	recovery := enrollment.RecoveryCodes[0]
	ok, err := store.VerifyMFA(ctx, id, recovery)
	if err != nil {
		t.Fatalf("VerifyMFA recovery: %v", err)
	}
	if !ok {
		t.Fatal("a fresh recovery code should verify")
	}
	ok, _ = store.VerifyMFA(ctx, id, recovery)
	if ok {
		t.Fatal("a recovery code must be single-use and rejected on reuse")
	}
}
