package authservice

import (
	"context"
	"database/sql"
	"time"
)

type User struct {
	ID              string
	Email           string
	PasswordHash    string
	Name            string
	Role            string
	MFAEnabled      bool
	MFASecret       sql.NullString
	EmailVerifiedAt sql.NullTime
	FailedAttempts  int32
	LockedUntil     sql.NullTime
	LastLoginAt     sql.NullTime
	CreatedAt       time.Time
	UpdatedAt       time.Time
	DeletedAt       sql.NullTime
}

type Session struct {
	ID               string
	UserID           string
	RefreshTokenHash string
	ParentSessionID  sql.NullString
	IPAddress        sql.NullString
	UserAgent        sql.NullString
	RevokedAt        sql.NullTime
	ExpiresAt        time.Time
	CreatedAt        time.Time
}

type Token struct {
	ID        string
	UserID    string
	TokenHash string
	ExpiresAt time.Time
	UsedAt    sql.NullTime
	CreatedAt time.Time
}

type RecoveryCode struct {
	ID        string
	UserID    string
	CodeHash  string
	UsedAt    sql.NullTime
	CreatedAt time.Time
}

type CreateUserParams struct {
	ID           string
	Email        string
	PasswordHash string
	Name         string
	Role         string
}

type CreateSessionParams struct {
	ID               string
	UserID           string
	RefreshTokenHash string
	ParentSessionID  sql.NullString
	IPAddress        sql.NullString
	UserAgent        sql.NullString
	ExpiresAt        time.Time
}

type CreateTokenParams struct {
	ID        string
	UserID    string
	TokenHash string
	ExpiresAt time.Time
}

type Querier interface {
	GetUserByID(ctx context.Context, id string) (*User, error)
	GetUserByEmail(ctx context.Context, email string) (*User, error)
	CountUsers(ctx context.Context) (int64, error)
	CreateUser(ctx context.Context, p CreateUserParams) (*User, error)
	UpdateUserPassword(ctx context.Context, id, hash string) error
	UpdateUserLastLogin(ctx context.Context, id string) error
	RecordLoginFailure(ctx context.Context, id string, maxAttempts, lockoutMinutes int) (int32, sql.NullTime, error)
	SetUserMFA(ctx context.Context, id string, enabled bool, secret sql.NullString) error
	MarkEmailVerified(ctx context.Context, id string) error

	CreateSession(ctx context.Context, p CreateSessionParams) (*Session, error)
	GetSessionByTokenHash(ctx context.Context, hash string) (*Session, error)
	GetSessionByID(ctx context.Context, id string) (*Session, error)
	GetChildSession(ctx context.Context, parentSessionID string) (*Session, error)
	ClaimSessionForRotation(ctx context.Context, id string) (int64, error)
	RevokeSession(ctx context.Context, id string) error
	RevokeSessionsForUser(ctx context.Context, userID string, exceptSessionID sql.NullString) error
	RevokeSessionChain(ctx context.Context, ids []string) error
	GetSessionAncestors(ctx context.Context, id string) ([]string, error)
	GetSessionDescendants(ctx context.Context, id string) ([]string, error)
	ListActiveSessionsForUser(ctx context.Context, userID string) ([]*Session, error)
	DeleteExpiredSessions(ctx context.Context) error

	CreatePasswordResetToken(ctx context.Context, p CreateTokenParams) error
	GetPasswordResetToken(ctx context.Context, hash string) (*Token, error)
	MarkPasswordResetTokenUsed(ctx context.Context, id string) error
	DeleteExpiredPasswordResetTokens(ctx context.Context) error

	CreateEmailVerifyToken(ctx context.Context, p CreateTokenParams) error
	GetEmailVerifyToken(ctx context.Context, hash string) (*Token, error)
	MarkEmailVerifyTokenUsed(ctx context.Context, id string) error
	DeleteExpiredEmailVerifyTokens(ctx context.Context) error

	CreateRecoveryCode(ctx context.Context, p CreateTokenParams) error
	GetUnusedRecoveryCodes(ctx context.Context, userID string) ([]*RecoveryCode, error)
	MarkRecoveryCodeUsed(ctx context.Context, id string) error
	DeleteRecoveryCodesForUser(ctx context.Context, userID string) error
}
