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

const sessionTTL = 12 * time.Hour

var ErrInvalidCredentials = errors.New("invalid credentials")

type AdminUser struct {
	ID    int64
	Email string
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
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO admin_panel.admin_users (email, password_hash) VALUES ($1, $2)`,
		email, hash,
	)
	return err
}

func (s *Store) Authenticate(ctx context.Context, email, password string) (*AdminUser, error) {
	var id int64
	var hash string
	err := s.pool.QueryRow(ctx,
		`SELECT id, password_hash FROM admin_panel.admin_users WHERE email = $1`,
		email,
	).Scan(&id, &hash)
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
	return &AdminUser{ID: id, Email: email}, nil
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
	if token == "" {
		return nil, ErrInvalidCredentials
	}
	var u AdminUser
	err := s.pool.QueryRow(ctx,
		`SELECT u.id, u.email
		   FROM admin_panel.admin_sessions s
		   JOIN admin_panel.admin_users u ON u.id = s.admin_id
		  WHERE s.token = $1 AND s.expires_at > NOW()`,
		token,
	).Scan(&u.ID, &u.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
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
