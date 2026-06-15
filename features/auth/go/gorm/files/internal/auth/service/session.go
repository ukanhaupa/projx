package authservice

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	authmodels "projx.local/go/internal/auth/models"
	"projx.local/go/internal/uuid"
)

const (
	LoginMaxAttempts    = 5
	LoginLockoutMinutes = 15
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrAccountLocked      = errors.New("account locked")
	ErrUserMissing        = errors.New("user missing")
	ErrReplayDetected     = errors.New("token replay detected")
	ErrRefreshInvalid     = errors.New("refresh token invalid")
)

type Sessions struct {
	db     *gorm.DB
	signer *Signer
}

func NewSessions(db *gorm.DB, signer *Signer) *Sessions {
	return &Sessions{db: db, signer: signer}
}

type IssueArgs struct {
	User      *authmodels.User
	IPAddress string
	UserAgent string
}

type IssuedSession struct {
	SessionID    string
	AccessToken  string
	RefreshToken string
}

func (s *Sessions) Issue(ctx context.Context, args IssueArgs) (*IssuedSession, error) {
	if args.User == nil {
		return nil, ErrUserMissing
	}
	sessionID := uuid.V4()
	pair, err := s.signer.IssueTokens(ctx, TokenPayload{
		Sub:         args.User.ID,
		SID:         sessionID,
		Email:       args.User.Email,
		Name:        args.User.Name,
		Role:        args.User.Role,
		Permissions: PermissionsForRole(args.User.Role),
	})
	if err != nil {
		return nil, err
	}
	row := &authmodels.RefreshToken{
		UserID:    args.User.ID,
		SessionID: sessionID,
		TokenHash: HashToken(pair.RefreshToken),
		IPAddress: args.IPAddress,
		UserAgent: args.UserAgent,
		ExpiresAt: time.Now().UTC().Add(RefreshTTL),
	}
	if err := s.db.WithContext(ctx).Create(row).Error; err != nil {
		return nil, err
	}
	return &IssuedSession{
		SessionID:    sessionID,
		AccessToken:  pair.AccessToken,
		RefreshToken: pair.RefreshToken,
	}, nil
}

type RotateArgs struct {
	RefreshToken string
	IPAddress    string
	UserAgent    string
}

func (s *Sessions) Rotate(ctx context.Context, args RotateArgs) (*IssuedSession, error) {
	claims, err := s.signer.VerifyRefreshToken(ctx, args.RefreshToken)
	if err != nil {
		return nil, ErrRefreshInvalid
	}
	if claims["token_type"] != "refresh" {
		return nil, ErrRefreshInvalid
	}
	sid, _ := claims["sid"].(string)
	sub, _ := claims["sub"].(string)
	if sid == "" || sub == "" {
		return nil, ErrRefreshInvalid
	}

	hash := HashToken(args.RefreshToken)
	var row authmodels.RefreshToken
	if err := s.db.WithContext(ctx).Where("token_hash = ?", hash).First(&row).Error; err != nil {
		return nil, ErrRefreshInvalid
	}
	if row.SessionID != sid || row.UserID != sub {
		return nil, ErrRefreshInvalid
	}

	if row.RotatedTo != nil || row.RevokedAt != nil {
		now := time.Now().UTC()
		s.db.WithContext(ctx).Model(&authmodels.RefreshToken{}).
			Where("session_id = ? AND revoked_at IS NULL", row.SessionID).
			Update("revoked_at", now)
		s.db.WithContext(ctx).Model(&authmodels.RefreshToken{}).
			Where("id = ?", row.ID).
			Update("replay_detected_at", now)
		return nil, ErrReplayDetected
	}

	if row.ExpiresAt.Before(time.Now().UTC()) {
		return nil, ErrRefreshInvalid
	}

	var user authmodels.User
	if err := s.db.WithContext(ctx).Where("id = ?", row.UserID).First(&user).Error; err != nil {
		return nil, ErrRefreshInvalid
	}

	pair, err := s.signer.IssueTokens(ctx, TokenPayload{
		Sub:         user.ID,
		SID:         row.SessionID,
		Email:       user.Email,
		Name:        user.Name,
		Role:        user.Role,
		Permissions: PermissionsForRole(user.Role),
	})
	if err != nil {
		return nil, err
	}

	newRow := &authmodels.RefreshToken{
		UserID:    user.ID,
		SessionID: row.SessionID,
		TokenHash: HashToken(pair.RefreshToken),
		IPAddress: args.IPAddress,
		UserAgent: args.UserAgent,
		ExpiresAt: time.Now().UTC().Add(RefreshTTL),
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(newRow).Error; err != nil {
			return err
		}
		now := time.Now().UTC()
		return tx.Model(&authmodels.RefreshToken{}).
			Where("id = ?", row.ID).
			Updates(map[string]any{"rotated_to": newRow.ID, "revoked_at": now}).Error
	})
	if err != nil {
		return nil, err
	}

	return &IssuedSession{
		SessionID:    row.SessionID,
		AccessToken:  pair.AccessToken,
		RefreshToken: pair.RefreshToken,
	}, nil
}

func (s *Sessions) RevokeSession(ctx context.Context, userID, sessionID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Model(&authmodels.RefreshToken{}).
		Where("session_id = ? AND user_id = ? AND revoked_at IS NULL", sessionID, userID).
		Update("revoked_at", now).Error
}

func (s *Sessions) RevokeAllForUser(ctx context.Context, userID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Model(&authmodels.RefreshToken{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Update("revoked_at", now).Error
}

func RegisterFailedLogin(db *gorm.DB, ctx context.Context, user *authmodels.User) error {
	next := user.FailedLoginCount + 1
	updates := map[string]any{"failed_login_count": next}
	if next >= LoginMaxAttempts {
		until := time.Now().UTC().Add(time.Duration(LoginLockoutMinutes) * time.Minute)
		updates["locked_until"] = until
	}
	return db.WithContext(ctx).Model(&authmodels.User{}).Where("id = ?", user.ID).Updates(updates).Error
}

func ResetLoginCounters(db *gorm.DB, ctx context.Context, userID string) error {
	return db.WithContext(ctx).Model(&authmodels.User{}).Where("id = ?", userID).
		Updates(map[string]any{"failed_login_count": 0, "locked_until": nil, "last_login": time.Now().UTC()}).Error
}

func RegisterMFAFailure(db *gorm.DB, ctx context.Context, user *authmodels.User) error {
	next := user.MFAFailedCount + 1
	updates := map[string]any{"mfa_failed_count": next}
	if next >= MFAMaxAttempts {
		until := time.Now().UTC().Add(time.Duration(MFALockoutMinutes) * time.Minute)
		updates["mfa_locked_until"] = until
	}
	return db.WithContext(ctx).Model(&authmodels.User{}).Where("id = ?", user.ID).Updates(updates).Error
}

func ResetMFACounters(db *gorm.DB, ctx context.Context, userID string) error {
	return db.WithContext(ctx).Model(&authmodels.User{}).Where("id = ?", userID).
		Updates(map[string]any{"mfa_failed_count": 0, "mfa_locked_until": nil}).Error
}

func IsAccountLocked(user *authmodels.User) bool {
	if user.LockedUntil == nil {
		return false
	}
	return user.LockedUntil.After(time.Now().UTC())
}
