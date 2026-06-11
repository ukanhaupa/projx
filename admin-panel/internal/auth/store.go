package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	sessionTTL              = 12 * time.Hour
	WriteModeTTL            = 30 * time.Minute
	MinBootstrapPasswordLen = 12
)

const (
	RoleReadOnly  = "read_only"
	RoleReadWrite = "read_write"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrReadOnlyRole       = errors.New("read-only admins cannot enable write mode")
)

type AdminUser struct {
	ID    int64
	Email string
	Role  string
}

func (u *AdminUser) CanWrite() bool {
	return u != nil && u.Role == RoleReadWrite
}

type Session struct {
	User         *AdminUser
	InWriteMode  bool
	WriteExpires time.Time
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func (s *Store) EnsureBootstrap(ctx context.Context, email, password string) error {
	if email == "" || password == "" {
		return nil
	}
	var count int
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM admin_panel.admin_users`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if len(password) < MinBootstrapPasswordLen {
		return errors.New("ADMIN_PASSWORD must be at least 12 characters")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO admin_panel.admin_users (email, password_hash, role) VALUES ($1, $2, $3)`,
		email, hash, RoleReadWrite,
	)
	return err
}

func (s *Store) Authenticate(ctx context.Context, email, password string) (*AdminUser, error) {
	var id int64
	var hash, role string
	err := s.pool.QueryRow(ctx,
		`SELECT id, password_hash, role FROM admin_panel.admin_users WHERE email = $1`,
		email,
	).Scan(&id, &hash, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	ok, err := VerifyPassword(password, hash)
	if err != nil || !ok {
		return nil, ErrInvalidCredentials
	}
	return &AdminUser{ID: id, Email: email, Role: role}, nil
}

func (s *Store) CreateSession(ctx context.Context, adminID int64) (string, error) {
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO admin_panel.admin_sessions (token, admin_id, expires_at) VALUES ($1, $2, $3)`,
		token, adminID, time.Now().Add(sessionTTL),
	)
	if err != nil {
		return "", err
	}
	return token, nil
}

func (s *Store) SessionUser(ctx context.Context, token string) (*AdminUser, error) {
	sess, err := s.LoadSession(ctx, token)
	if err != nil {
		return nil, err
	}
	return sess.User, nil
}

func (s *Store) LoadSession(ctx context.Context, token string) (*Session, error) {
	if token == "" {
		return nil, ErrInvalidCredentials
	}
	var u AdminUser
	var writeUntil *time.Time
	err := s.pool.QueryRow(ctx,
		`SELECT u.id, u.email, u.role, s.write_mode_until
		   FROM admin_panel.admin_sessions s
		   JOIN admin_panel.admin_users u ON u.id = s.admin_id
		  WHERE s.token = $1 AND s.expires_at > NOW()`,
		token,
	).Scan(&u.ID, &u.Email, &u.Role, &writeUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	sess := &Session{User: &u}
	if u.CanWrite() && writeUntil != nil && writeUntil.After(time.Now()) {
		sess.InWriteMode = true
		sess.WriteExpires = *writeUntil
	}
	return sess, nil
}

func (s *Store) SetWriteMode(ctx context.Context, token string, on bool) (time.Time, error) {
	if !on {
		_, err := s.pool.Exec(ctx,
			`UPDATE admin_panel.admin_sessions SET write_mode_until = NULL WHERE token = $1`,
			token,
		)
		return time.Time{}, err
	}
	var role string
	err := s.pool.QueryRow(ctx,
		`SELECT u.role
		   FROM admin_panel.admin_sessions s
		   JOIN admin_panel.admin_users u ON u.id = s.admin_id
		  WHERE s.token = $1 AND s.expires_at > NOW()`,
		token,
	).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, ErrInvalidCredentials
	}
	if err != nil {
		return time.Time{}, err
	}
	if role != RoleReadWrite {
		return time.Time{}, ErrReadOnlyRole
	}
	expires := time.Now().Add(WriteModeTTL)
	tag, err := s.pool.Exec(ctx,
		`UPDATE admin_panel.admin_sessions
		    SET write_mode_until = $2
		  WHERE token = $1 AND expires_at > NOW()`,
		token, expires,
	)
	if err != nil {
		return time.Time{}, err
	}
	if tag.RowsAffected() == 0 {
		return time.Time{}, ErrInvalidCredentials
	}
	return expires, nil
}

func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM admin_panel.admin_sessions WHERE token = $1`, token)
	return err
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
