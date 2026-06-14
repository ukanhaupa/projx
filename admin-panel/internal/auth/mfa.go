package auth

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pquerna/otp/totp"
)

const (
	totpIssuer        = "projx admin-panel"
	recoveryCodeCount = 10
	mfaMaxAttempts    = 5
	mfaLockWindow     = 15 * time.Minute
)

var (
	ErrMFAFailed = errors.New("invalid authentication code")
	ErrMFALocked = errors.New("too many attempts, try again later")
)

type Enrollment struct {
	Secret        string
	OTPAuthURL    string
	RecoveryCodes []string
}

func nowUTC() time.Time { return time.Now() }

func OTPAuthURL(secret, account string) string {
	v := url.Values{}
	v.Set("secret", secret)
	v.Set("issuer", totpIssuer)
	v.Set("algorithm", "SHA1")
	v.Set("digits", "6")
	v.Set("period", "30")
	u := url.URL{
		Scheme:   "otpauth",
		Host:     "totp",
		Path:     "/" + totpIssuer + ":" + account,
		RawQuery: v.Encode(),
	}
	return u.String()
}

func (s *Store) MFAEnrolled(ctx context.Context, adminID int64) (bool, error) {
	var enrolledAt *time.Time
	err := s.pool.QueryRow(ctx,
		`SELECT totp_enrolled_at FROM admin_panel.admin_users WHERE id = $1`,
		adminID,
	).Scan(&enrolledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrInvalidCredentials
	}
	if err != nil {
		return false, err
	}
	return enrolledAt != nil, nil
}

func (s *Store) BeginEnrollment(ctx context.Context, adminID int64) (*Enrollment, error) {
	var email string
	if err := s.pool.QueryRow(ctx,
		`SELECT email FROM admin_panel.admin_users WHERE id = $1`, adminID,
	).Scan(&email); err != nil {
		return nil, err
	}
	key, err := totp.Generate(totp.GenerateOpts{Issuer: totpIssuer, AccountName: email})
	if err != nil {
		return nil, err
	}
	codes, err := generateRecoveryCodes()
	if err != nil {
		return nil, err
	}
	return &Enrollment{Secret: key.Secret(), OTPAuthURL: key.URL(), RecoveryCodes: codes}, nil
}

func (s *Store) CompleteEnrollment(ctx context.Context, adminID int64, secret string, recoveryCodes []string, code string) error {
	if !totp.Validate(code, secret) {
		return ErrMFAFailed
	}
	enc, err := encryptSecret(secret, s.sessionSecret)
	if err != nil {
		return err
	}
	return pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`UPDATE admin_panel.admin_users
			    SET totp_secret_enc = $2, totp_enrolled_at = NOW()
			  WHERE id = $1 AND totp_enrolled_at IS NULL`,
			adminID, enc,
		)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrMFAFailed
		}
		for _, rc := range recoveryCodes {
			hash, err := HashPassword(rc)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO admin_panel.admin_recovery_codes (admin_id, code_hash) VALUES ($1, $2)`,
				adminID, hash,
			); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) VerifyMFA(ctx context.Context, adminID int64, code string) (bool, error) {
	var enc *string
	err := s.pool.QueryRow(ctx,
		`SELECT totp_secret_enc FROM admin_panel.admin_users WHERE id = $1 AND totp_enrolled_at IS NOT NULL`,
		adminID,
	).Scan(&enc)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if enc != nil {
		secret, err := decryptSecret(*enc, s.sessionSecret)
		if err != nil {
			return false, err
		}
		if totp.Validate(code, secret) {
			return true, nil
		}
	}
	return s.consumeRecoveryCode(ctx, adminID, code)
}

func (s *Store) VerifyMFAChallenge(ctx context.Context, adminID int64, code string) (bool, error) {
	locked, err := s.mfaLocked(ctx, adminID)
	if err != nil {
		return false, err
	}
	if locked {
		return false, ErrMFALocked
	}
	ok, err := s.VerifyMFA(ctx, adminID, code)
	if err != nil {
		return false, err
	}
	if ok {
		if err := s.resetMFAFailures(ctx, adminID); err != nil {
			return false, err
		}
		return true, nil
	}
	if err := s.recordMFAFailure(ctx, adminID); err != nil {
		return false, err
	}
	return false, nil
}

func (s *Store) mfaLocked(ctx context.Context, adminID int64) (bool, error) {
	var locked bool
	err := s.pool.QueryRow(ctx,
		`SELECT mfa_locked_until IS NOT NULL AND mfa_locked_until > NOW()
		   FROM admin_panel.admin_users WHERE id = $1`,
		adminID,
	).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrInvalidCredentials
	}
	if err != nil {
		return false, err
	}
	return locked, nil
}

func (s *Store) recordMFAFailure(ctx context.Context, adminID int64) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE admin_panel.admin_users
		    SET mfa_failed_attempts = CASE WHEN mfa_failed_attempts + 1 >= $2 THEN 0 ELSE mfa_failed_attempts + 1 END,
		        mfa_locked_until     = CASE WHEN mfa_failed_attempts + 1 >= $2 THEN NOW() + $3::interval ELSE mfa_locked_until END
		  WHERE id = $1`,
		adminID, mfaMaxAttempts, mfaLockWindow.String(),
	)
	return err
}

func (s *Store) resetMFAFailures(ctx context.Context, adminID int64) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE admin_panel.admin_users
		    SET mfa_failed_attempts = 0, mfa_locked_until = NULL
		  WHERE id = $1`,
		adminID,
	)
	return err
}

func (s *Store) consumeRecoveryCode(ctx context.Context, adminID int64, code string) (bool, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, code_hash FROM admin_panel.admin_recovery_codes WHERE admin_id = $1 AND used_at IS NULL`,
		adminID,
	)
	if err != nil {
		return false, err
	}
	type candidate struct {
		id   int64
		hash string
	}
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.id, &c.hash); err != nil {
			rows.Close()
			return false, err
		}
		candidates = append(candidates, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return false, err
	}
	for _, c := range candidates {
		ok, err := VerifyPassword(code, c.hash)
		if err != nil || !ok {
			continue
		}
		tag, err := s.pool.Exec(ctx,
			`UPDATE admin_panel.admin_recovery_codes SET used_at = NOW() WHERE id = $1 AND used_at IS NULL`,
			c.id,
		)
		if err != nil {
			return false, err
		}
		return tag.RowsAffected() == 1, nil
	}
	return false, nil
}

func (s *Store) MarkSessionMFAPassed(ctx context.Context, token string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE admin_panel.admin_sessions SET mfa_passed = TRUE WHERE token = $1 AND expires_at > NOW()`,
		token,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidCredentials
	}
	return nil
}

func generateRecoveryCodes() ([]string, error) {
	codes := make([]string, 0, recoveryCodeCount)
	for i := 0; i < recoveryCodeCount; i++ {
		b := make([]byte, 10)
		if _, err := rand.Read(b); err != nil {
			return nil, err
		}
		codes = append(codes, base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b))
	}
	return codes, nil
}
