package authservice

import (
	"context"
	"errors"
	"time"

	"projx.local/go/ent"
	"projx.local/go/ent/emailverifytoken"
	"projx.local/go/ent/passwordresettoken"
	"projx.local/go/ent/recoverycode"
	"projx.local/go/ent/session"
	"projx.local/go/ent/user"
	"projx.local/go/internal/apperr"
	"projx.local/go/internal/uuid"
)

const (
	LoginMaxAttempts            = 5
	LoginLockoutMs              = 15 * 60 * 1000
	ResetTokenTTL               = 30 * time.Minute
	EmailVerifyTokenTTL         = 24 * time.Hour
	RevokedRetentionDays        = 30
)

type Service struct {
	client *ent.Client
	signer *Signer
	cipher *Cipher
}

func NewService(client *ent.Client, signer *Signer, cipher *Cipher) *Service {
	return &Service{client: client, signer: signer, cipher: cipher}
}

func (s *Service) Client() *ent.Client { return s.client }

func (s *Service) Signer() *Signer { return s.signer }

func (s *Service) Cipher() *Cipher { return s.cipher }

func (s *Service) FindUserByEmail(ctx context.Context, email string) (*ent.User, error) {
	u, err := s.client.User.Query().
		Where(user.EmailEQ(email), user.DeletedAtIsNil()).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, apperr.NotFound("user")
		}
		return nil, err
	}
	return u, nil
}

func (s *Service) FindUserByID(ctx context.Context, id string) (*ent.User, error) {
	u, err := s.client.User.Query().Where(user.IDEQ(id), user.DeletedAtIsNil()).Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, apperr.NotFound("user")
		}
		return nil, err
	}
	return u, nil
}

func (s *Service) CountUsers(ctx context.Context) (int, error) {
	return s.client.User.Query().Count(ctx)
}

func (s *Service) CreateUser(ctx context.Context, email, name, passwordHash, role string) (*ent.User, error) {
	id := uuid.V4()
	u, err := s.client.User.Create().
		SetID(id).
		SetEmail(email).
		SetName(name).
		SetPasswordHash(passwordHash).
		SetRole(role).
		Save(ctx)
	if err != nil {
		return nil, apperr.FromDB(err, "user")
	}
	return u, nil
}

func (s *Service) IssueSession(ctx context.Context, u *ent.User, ip, userAgent string) (*AuthSessionResponse, error) {
	sessionID := uuid.V4()
	payload := TokenPayload{
		Sub:         u.ID,
		SID:         sessionID,
		Email:       u.Email,
		Name:        u.Name,
		Role:        u.Role,
		Permissions: PermissionsForRole(u.Role),
	}
	pair, err := s.signer.IssueTokens(ctx, payload)
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().Add(RefreshTTL)
	if _, err := s.client.Session.Create().
		SetID(uuid.V4()).
		SetUserID(u.ID).
		SetSessionID(sessionID).
		SetTokenHash(HashToken(pair.RefreshToken)).
		SetIPAddress(ip).
		SetUserAgent(userAgent).
		SetExpiresAt(expiresAt).
		Save(ctx); err != nil {
		return nil, apperr.FromDB(err, "session")
	}
	return &AuthSessionResponse{
		User:         toUserDTO(u),
		Token:        pair.AccessToken,
		AccessToken:  pair.AccessToken,
		RefreshToken: pair.RefreshToken,
	}, nil
}

func toUserDTO(u *ent.User) UserDTO {
	dto := UserDTO{
		ID:            u.ID,
		Email:         u.Email,
		Name:          u.Name,
		Role:          u.Role,
		EmailVerified: u.EmailVerified,
		MFAEnabled:    u.MfaEnabled,
		CreatedAt:     u.CreatedAt,
		UpdatedAt:     u.UpdatedAt,
	}
	if u.LastLogin != nil {
		dto.LastLogin = u.LastLogin
	}
	return dto
}

func (s *Service) UserDTO(u *ent.User) UserDTO { return toUserDTO(u) }

func (s *Service) RecordFailedLogin(ctx context.Context, u *ent.User) error {
	next := u.FailedLoginCount + 1
	upd := s.client.User.UpdateOneID(u.ID).SetFailedLoginCount(next)
	if next >= LoginMaxAttempts {
		until := time.Now().Add(time.Duration(LoginLockoutMs) * time.Millisecond)
		upd = upd.SetLockedUntil(until)
	}
	_, err := upd.Save(ctx)
	return err
}

func (s *Service) ResetLoginCounters(ctx context.Context, userID string) (*ent.User, error) {
	return s.client.User.UpdateOneID(userID).
		SetLastLogin(time.Now()).
		SetFailedLoginCount(0).
		ClearLockedUntil().
		Save(ctx)
}

func (s *Service) RecordMFAFailure(ctx context.Context, u *ent.User) error {
	next := u.MfaFailedCount + 1
	upd := s.client.User.UpdateOneID(u.ID).SetMfaFailedCount(next)
	if next >= MFAMaxAttempts {
		until := time.Now().Add(time.Duration(MFALockoutMs) * time.Millisecond)
		upd = upd.SetMfaLockedUntil(until)
	}
	_, err := upd.Save(ctx)
	return err
}

func (s *Service) ResetMFACounters(ctx context.Context, userID string) error {
	_, err := s.client.User.UpdateOneID(userID).
		SetMfaFailedCount(0).
		ClearMfaLockedUntil().
		Save(ctx)
	return err
}

func (s *Service) FindSessionByTokenHash(ctx context.Context, tokenHash string) (*ent.Session, error) {
	sess, err := s.client.Session.Query().
		Where(session.TokenHashEQ(tokenHash)).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, apperr.Unauthorized("")
		}
		return nil, err
	}
	return sess, nil
}

func (s *Service) RotateSession(ctx context.Context, prev *ent.Session, u *ent.User, ip, userAgent string) (*AuthSessionResponse, error) {
	payload := TokenPayload{
		Sub:         u.ID,
		SID:         prev.SessionID,
		Email:       u.Email,
		Name:        u.Name,
		Role:        u.Role,
		Permissions: PermissionsForRole(u.Role),
	}
	pair, err := s.signer.IssueTokens(ctx, payload)
	if err != nil {
		return nil, err
	}
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	newID := uuid.V4()
	expiresAt := time.Now().Add(RefreshTTL)
	if _, err := tx.Session.Create().
		SetID(newID).
		SetUserID(u.ID).
		SetSessionID(prev.SessionID).
		SetTokenHash(HashToken(pair.RefreshToken)).
		SetIPAddress(ip).
		SetUserAgent(userAgent).
		SetExpiresAt(expiresAt).
		SetParentSessionID(prev.ID).
		Save(ctx); err != nil {
		_ = tx.Rollback()
		return nil, apperr.FromDB(err, "session")
	}
	if _, err := tx.Session.UpdateOneID(prev.ID).
		SetRotatedTo(newID).
		SetRevokedAt(time.Now()).
		Save(ctx); err != nil {
		_ = tx.Rollback()
		return nil, apperr.FromDB(err, "session")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &AuthSessionResponse{
		User:         toUserDTO(u),
		Token:        pair.AccessToken,
		AccessToken:  pair.AccessToken,
		RefreshToken: pair.RefreshToken,
	}, nil
}

func (s *Service) MarkSessionReplay(ctx context.Context, sess *ent.Session) error {
	now := time.Now()
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return err
	}
	if _, err := tx.Session.Update().
		Where(session.Or(session.IDEQ(sess.ID), session.ParentSessionIDEQ(sess.ID))).
		Where(session.RevokedAtIsNil()).
		SetRevokedAt(now).
		Save(ctx); err != nil {
		_ = tx.Rollback()
		return err
	}
	if _, err := tx.Session.UpdateOneID(sess.ID).
		SetReplayDetectedAt(now).
		Save(ctx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (s *Service) RevokeSessionsBySessionID(ctx context.Context, userID, sessionID string) error {
	_, err := s.client.Session.Update().
		Where(
			session.UserIDEQ(userID),
			session.SessionIDEQ(sessionID),
			session.RevokedAtIsNil(),
		).
		SetRevokedAt(time.Now()).
		Save(ctx)
	return err
}

func (s *Service) RevokeOtherSessions(ctx context.Context, userID, keepSessionID string) error {
	q := s.client.Session.Update().
		Where(session.UserIDEQ(userID), session.RevokedAtIsNil())
	if keepSessionID != "" {
		q = q.Where(session.SessionIDNEQ(keepSessionID))
	}
	_, err := q.SetRevokedAt(time.Now()).Save(ctx)
	return err
}

func (s *Service) RevokeAllUserSessions(ctx context.Context, userID string) error {
	_, err := s.client.Session.Update().
		Where(session.UserIDEQ(userID), session.RevokedAtIsNil()).
		SetRevokedAt(time.Now()).
		Save(ctx)
	return err
}

func (s *Service) ListActiveSessions(ctx context.Context, userID string) ([]*ent.Session, error) {
	return s.client.Session.Query().
		Where(
			session.UserIDEQ(userID),
			session.RevokedAtIsNil(),
			session.ExpiresAtGT(time.Now()),
		).
		Order(ent.Desc(session.FieldCreatedAt)).
		All(ctx)
}

func (s *Service) UpdatePasswordHash(ctx context.Context, userID, hash string) error {
	_, err := s.client.User.UpdateOneID(userID).SetPasswordHash(hash).Save(ctx)
	return err
}

func (s *Service) CreatePasswordResetToken(ctx context.Context, userID, tokenHash string, ttl time.Duration) (*ent.PasswordResetToken, error) {
	return s.client.PasswordResetToken.Create().
		SetID(uuid.V4()).
		SetUserID(userID).
		SetTokenHash(tokenHash).
		SetExpiresAt(time.Now().Add(ttl)).
		Save(ctx)
}

func (s *Service) FindActivePasswordReset(ctx context.Context, tokenHash string) (*ent.PasswordResetToken, error) {
	rec, err := s.client.PasswordResetToken.Query().
		Where(
			passwordresettoken.TokenHashEQ(tokenHash),
			passwordresettoken.ConsumedAtIsNil(),
			passwordresettoken.ExpiresAtGT(time.Now()),
		).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, apperr.Validation("Invalid or expired reset token")
		}
		return nil, err
	}
	return rec, nil
}

func (s *Service) ConsumePasswordReset(ctx context.Context, id string) error {
	_, err := s.client.PasswordResetToken.UpdateOneID(id).SetConsumedAt(time.Now()).Save(ctx)
	return err
}

func (s *Service) CreateEmailVerifyToken(ctx context.Context, userID, tokenHash string, ttl time.Duration) (*ent.EmailVerifyToken, error) {
	return s.client.EmailVerifyToken.Create().
		SetID(uuid.V4()).
		SetUserID(userID).
		SetTokenHash(tokenHash).
		SetExpiresAt(time.Now().Add(ttl)).
		Save(ctx)
}

func (s *Service) FindActiveEmailVerify(ctx context.Context, tokenHash string) (*ent.EmailVerifyToken, error) {
	rec, err := s.client.EmailVerifyToken.Query().
		Where(
			emailverifytoken.TokenHashEQ(tokenHash),
			emailverifytoken.ConsumedAtIsNil(),
			emailverifytoken.ExpiresAtGT(time.Now()),
		).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, apperr.Validation("Invalid or expired verification token")
		}
		return nil, err
	}
	return rec, nil
}

func (s *Service) MarkEmailVerified(ctx context.Context, userID, tokenID string) error {
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	if _, err := tx.User.UpdateOneID(userID).
		SetEmailVerified(true).
		SetEmailVerifiedAt(now).
		Save(ctx); err != nil {
		_ = tx.Rollback()
		return err
	}
	if _, err := tx.EmailVerifyToken.UpdateOneID(tokenID).SetConsumedAt(now).Save(ctx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (s *Service) ReplaceRecoveryCodes(ctx context.Context, userID string, hashes []string) error {
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return err
	}
	if _, err := tx.RecoveryCode.Delete().Where(recoverycode.UserIDEQ(userID)).Exec(ctx); err != nil {
		_ = tx.Rollback()
		return err
	}
	for _, h := range hashes {
		if _, err := tx.RecoveryCode.Create().
			SetID(uuid.V4()).
			SetUserID(userID).
			SetCodeHash(h).
			Save(ctx); err != nil {
			_ = tx.Rollback()
			return apperr.FromDB(err, "recovery_code")
		}
	}
	return tx.Commit()
}

func (s *Service) ConsumeRecoveryCode(ctx context.Context, userID, plaintext string) (bool, error) {
	codes, err := s.client.RecoveryCode.Query().
		Where(recoverycode.UserIDEQ(userID), recoverycode.ConsumedAtIsNil()).
		All(ctx)
	if err != nil {
		return false, err
	}
	normalized := DenormalizeRecoveryCode(plaintext)
	for _, code := range codes {
		if VerifyPassword(normalized, code.CodeHash) {
			if _, err := s.client.RecoveryCode.UpdateOneID(code.ID).SetConsumedAt(time.Now()).Save(ctx); err != nil {
				return false, err
			}
			return true, nil
		}
	}
	return false, nil
}

func (s *Service) EnableMFA(ctx context.Context, userID, secretEnc string) error {
	_, err := s.client.User.UpdateOneID(userID).
		SetMfaEnabled(true).
		SetMfaSecretEnc(secretEnc).
		SetMfaVerifiedAt(time.Now()).
		SetMfaFailedCount(0).
		ClearMfaLockedUntil().
		Save(ctx)
	return err
}

func (s *Service) BeginMFAEnrollment(ctx context.Context, userID, secretEnc string) error {
	_, err := s.client.User.UpdateOneID(userID).
		SetMfaSecretEnc(secretEnc).
		ClearMfaVerifiedAt().
		Save(ctx)
	return err
}

func (s *Service) DisableMFA(ctx context.Context, userID string) error {
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return err
	}
	if _, err := tx.User.UpdateOneID(userID).
		SetMfaEnabled(false).
		ClearMfaSecretEnc().
		ClearMfaVerifiedAt().
		SetMfaFailedCount(0).
		ClearMfaLockedUntil().
		Save(ctx); err != nil {
		_ = tx.Rollback()
		return err
	}
	if _, err := tx.RecoveryCode.Delete().Where(recoverycode.UserIDEQ(userID)).Exec(ctx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (s *Service) NewError(code int, detail string) error {
	switch code {
	case 400:
		return apperr.Validation(detail)
	case 401:
		return apperr.Unauthorized(detail)
	case 403:
		return apperr.Forbidden(detail)
	case 404:
		return apperr.NotFound(detail)
	case 409:
		return apperr.Conflict(detail)
	default:
		return errors.New(detail)
	}
}
