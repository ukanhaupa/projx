package authservice

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"projx.local/go/internal/apperr"
)

type sqlQuerier struct {
	db *sql.DB
}

func NewSQLQuerier(db *sql.DB) Querier {
	return &sqlQuerier{db: db}
}

const userCols = `id, email, password_hash, name, role, mfa_enabled, mfa_secret,
       email_verified_at, failed_attempts, locked_until, last_login_at,
       created_at, updated_at, deleted_at`

func scanUser(row interface {
	Scan(dest ...any) error
}) (*User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.MFAEnabled,
		&u.MFASecret, &u.EmailVerifiedAt, &u.FailedAttempts, &u.LockedUntil,
		&u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt, &u.DeletedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, apperr.NotFound("user")
		}
		return nil, err
	}
	return &u, nil
}

func (q *sqlQuerier) GetUserByID(ctx context.Context, id string) (*User, error) {
	row := q.db.QueryRowContext(ctx, `SELECT `+userCols+` FROM auth_users WHERE id = $1 AND deleted_at IS NULL`, id)
	return scanUser(row)
}

func (q *sqlQuerier) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	row := q.db.QueryRowContext(ctx, `SELECT `+userCols+` FROM auth_users WHERE email = $1 AND deleted_at IS NULL`, email)
	return scanUser(row)
}

func (q *sqlQuerier) CountUsers(ctx context.Context) (int64, error) {
	var n int64
	err := q.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM auth_users WHERE deleted_at IS NULL`).Scan(&n)
	return n, err
}

func (q *sqlQuerier) CreateUser(ctx context.Context, p CreateUserParams) (*User, error) {
	row := q.db.QueryRowContext(ctx, `
		INSERT INTO auth_users (id, email, password_hash, name, role, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
		RETURNING `+userCols, p.ID, p.Email, p.PasswordHash, p.Name, p.Role)
	u, err := scanUser(row)
	if err != nil {
		return nil, apperr.FromDB(err, "user")
	}
	return u, nil
}

func (q *sqlQuerier) UpdateUserPassword(ctx context.Context, id, hash string) error {
	_, err := q.db.ExecContext(ctx, `UPDATE auth_users SET password_hash = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, id, hash)
	return err
}

func (q *sqlQuerier) UpdateUserLastLogin(ctx context.Context, id string) error {
	_, err := q.db.ExecContext(ctx, `UPDATE auth_users SET last_login_at = NOW(), failed_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, id)
	return err
}

func (q *sqlQuerier) RecordLoginFailure(ctx context.Context, id string, maxAttempts, lockoutMinutes int) (int32, sql.NullTime, error) {
	var attempts int32
	var locked sql.NullTime
	row := q.db.QueryRowContext(ctx, fmt.Sprintf(`
		UPDATE auth_users
		SET failed_attempts = failed_attempts + 1,
		    locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN NOW() + INTERVAL '%d minutes' ELSE locked_until END,
		    updated_at = NOW()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING failed_attempts, locked_until`, lockoutMinutes), id, maxAttempts)
	if err := row.Scan(&attempts, &locked); err != nil {
		return 0, sql.NullTime{}, err
	}
	return attempts, locked, nil
}

func (q *sqlQuerier) SetUserMFA(ctx context.Context, id string, enabled bool, secret sql.NullString) error {
	_, err := q.db.ExecContext(ctx, `UPDATE auth_users SET mfa_enabled = $2, mfa_secret = $3, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, id, enabled, secret)
	return err
}

func (q *sqlQuerier) MarkEmailVerified(ctx context.Context, id string) error {
	_, err := q.db.ExecContext(ctx, `UPDATE auth_users SET email_verified_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, id)
	return err
}

const sessionCols = `id, user_id, refresh_token_hash, parent_session_id, ip_address, user_agent, revoked_at, expires_at, created_at`

func scanSession(row interface {
	Scan(dest ...any) error
}) (*Session, error) {
	var s Session
	err := row.Scan(&s.ID, &s.UserID, &s.RefreshTokenHash, &s.ParentSessionID,
		&s.IPAddress, &s.UserAgent, &s.RevokedAt, &s.ExpiresAt, &s.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, apperr.NotFound("session")
		}
		return nil, err
	}
	return &s, nil
}

func (q *sqlQuerier) CreateSession(ctx context.Context, p CreateSessionParams) (*Session, error) {
	row := q.db.QueryRowContext(ctx, `
		INSERT INTO auth_sessions (id, user_id, refresh_token_hash, parent_session_id, ip_address, user_agent, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		RETURNING `+sessionCols,
		p.ID, p.UserID, p.RefreshTokenHash, p.ParentSessionID, p.IPAddress, p.UserAgent, p.ExpiresAt)
	return scanSession(row)
}

func (q *sqlQuerier) GetSessionByTokenHash(ctx context.Context, hash string) (*Session, error) {
	row := q.db.QueryRowContext(ctx, `SELECT `+sessionCols+` FROM auth_sessions WHERE refresh_token_hash = $1`, hash)
	return scanSession(row)
}

func (q *sqlQuerier) GetSessionByID(ctx context.Context, id string) (*Session, error) {
	row := q.db.QueryRowContext(ctx, `SELECT `+sessionCols+` FROM auth_sessions WHERE id = $1`, id)
	return scanSession(row)
}

func (q *sqlQuerier) RevokeSession(ctx context.Context, id string) error {
	_, err := q.db.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`, id)
	return err
}

func (q *sqlQuerier) RevokeSessionsForUser(ctx context.Context, userID string, except sql.NullString) error {
	if except.Valid {
		_, err := q.db.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2`, userID, except.String)
		return err
	}
	_, err := q.db.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, userID)
	return err
}

func (q *sqlQuerier) RevokeSessionChain(ctx context.Context, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := q.db.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at = NOW() WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL`, ids)
	return err
}

func (q *sqlQuerier) GetSessionAncestors(ctx context.Context, id string) ([]string, error) {
	rows, err := q.db.QueryContext(ctx, `
		WITH RECURSIVE ancestry AS (
			SELECT id, parent_session_id FROM auth_sessions WHERE id = $1
			UNION ALL
			SELECT s.id, s.parent_session_id
			FROM auth_sessions s
			JOIN ancestry a ON s.id = a.parent_session_id
		)
		SELECT id FROM ancestry`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err != nil {
			return nil, err
		}
		out = append(out, sid)
	}
	return out, rows.Err()
}

func (q *sqlQuerier) GetSessionDescendants(ctx context.Context, id string) ([]string, error) {
	rows, err := q.db.QueryContext(ctx, `
		WITH RECURSIVE descendants AS (
			SELECT id, parent_session_id FROM auth_sessions WHERE id = $1
			UNION ALL
			SELECT s.id, s.parent_session_id
			FROM auth_sessions s
			JOIN descendants d ON s.parent_session_id = d.id
		)
		SELECT id FROM descendants`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err != nil {
			return nil, err
		}
		out = append(out, sid)
	}
	return out, rows.Err()
}

func (q *sqlQuerier) ListActiveSessionsForUser(ctx context.Context, userID string) ([]*Session, error) {
	rows, err := q.db.QueryContext(ctx, `SELECT `+sessionCols+` FROM auth_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*Session, 0)
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (q *sqlQuerier) DeleteExpiredSessions(ctx context.Context) error {
	_, err := q.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE expires_at < NOW() - INTERVAL '7 days'`)
	return err
}

func (q *sqlQuerier) CreatePasswordResetToken(ctx context.Context, p CreateTokenParams) error {
	_, err := q.db.ExecContext(ctx, `INSERT INTO auth_password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4, NOW())`,
		p.ID, p.UserID, p.TokenHash, p.ExpiresAt)
	return apperr.FromDB(err, "password_reset_token")
}

func (q *sqlQuerier) GetPasswordResetToken(ctx context.Context, hash string) (*Token, error) {
	row := q.db.QueryRowContext(ctx, `SELECT id, user_id, token_hash, expires_at, used_at, created_at FROM auth_password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`, hash)
	var t Token
	if err := row.Scan(&t.ID, &t.UserID, &t.TokenHash, &t.ExpiresAt, &t.UsedAt, &t.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, apperr.NotFound("password_reset_token")
		}
		return nil, err
	}
	return &t, nil
}

func (q *sqlQuerier) MarkPasswordResetTokenUsed(ctx context.Context, id string) error {
	_, err := q.db.ExecContext(ctx, `UPDATE auth_password_reset_tokens SET used_at = NOW() WHERE id = $1 AND used_at IS NULL`, id)
	return err
}

func (q *sqlQuerier) DeleteExpiredPasswordResetTokens(ctx context.Context) error {
	_, err := q.db.ExecContext(ctx, `DELETE FROM auth_password_reset_tokens WHERE expires_at < NOW()`)
	return err
}

func (q *sqlQuerier) CreateEmailVerifyToken(ctx context.Context, p CreateTokenParams) error {
	_, err := q.db.ExecContext(ctx, `INSERT INTO auth_email_verify_tokens (id, user_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4, NOW())`,
		p.ID, p.UserID, p.TokenHash, p.ExpiresAt)
	return apperr.FromDB(err, "email_verify_token")
}

func (q *sqlQuerier) GetEmailVerifyToken(ctx context.Context, hash string) (*Token, error) {
	row := q.db.QueryRowContext(ctx, `SELECT id, user_id, token_hash, expires_at, used_at, created_at FROM auth_email_verify_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`, hash)
	var t Token
	if err := row.Scan(&t.ID, &t.UserID, &t.TokenHash, &t.ExpiresAt, &t.UsedAt, &t.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, apperr.NotFound("email_verify_token")
		}
		return nil, err
	}
	return &t, nil
}

func (q *sqlQuerier) MarkEmailVerifyTokenUsed(ctx context.Context, id string) error {
	_, err := q.db.ExecContext(ctx, `UPDATE auth_email_verify_tokens SET used_at = NOW() WHERE id = $1 AND used_at IS NULL`, id)
	return err
}

func (q *sqlQuerier) DeleteExpiredEmailVerifyTokens(ctx context.Context) error {
	_, err := q.db.ExecContext(ctx, `DELETE FROM auth_email_verify_tokens WHERE expires_at < NOW()`)
	return err
}

func (q *sqlQuerier) CreateRecoveryCode(ctx context.Context, p CreateTokenParams) error {
	_, err := q.db.ExecContext(ctx, `INSERT INTO auth_recovery_codes (id, user_id, code_hash, created_at) VALUES ($1, $2, $3, NOW())`,
		p.ID, p.UserID, p.TokenHash)
	return apperr.FromDB(err, "recovery_code")
}

func (q *sqlQuerier) GetUnusedRecoveryCodes(ctx context.Context, userID string) ([]*RecoveryCode, error) {
	rows, err := q.db.QueryContext(ctx, `SELECT id, user_id, code_hash, used_at, created_at FROM auth_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*RecoveryCode, 0)
	for rows.Next() {
		var r RecoveryCode
		if err := rows.Scan(&r.ID, &r.UserID, &r.CodeHash, &r.UsedAt, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &r)
	}
	return out, rows.Err()
}

func (q *sqlQuerier) MarkRecoveryCodeUsed(ctx context.Context, id string) error {
	_, err := q.db.ExecContext(ctx, `UPDATE auth_recovery_codes SET used_at = NOW() WHERE id = $1 AND used_at IS NULL`, id)
	return err
}

func (q *sqlQuerier) DeleteRecoveryCodesForUser(ctx context.Context, userID string) error {
	_, err := q.db.ExecContext(ctx, `DELETE FROM auth_recovery_codes WHERE user_id = $1`, userID)
	return err
}
