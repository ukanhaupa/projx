package authservice

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/uuid"
)

type IssueSessionInput struct {
	User      *User
	IPAddress string
	UserAgent string
}

type IssueSessionResult struct {
	SessionID string
	Tokens    *TokenPair
}

type Service struct {
	q       Querier
	secrets *Secrets
}

func New(q Querier, secrets *Secrets) *Service {
	return &Service{q: q, secrets: secrets}
}

func (s *Service) Querier() Querier { return s.q }
func (s *Service) Secrets() *Secrets { return s.secrets }

func nullStr(v string) sql.NullString {
	if v == "" {
		return sql.NullString{}
	}
	return sql.NullString{Valid: true, String: v}
}

func (s *Service) IssueSession(ctx context.Context, in IssueSessionInput) (*IssueSessionResult, error) {
	return s.issueRotated(ctx, in, sql.NullString{})
}

func (s *Service) issueRotated(ctx context.Context, in IssueSessionInput, parent sql.NullString) (*IssueSessionResult, error) {
	sessionID := uuid.V4()
	claims := Claims{}
	claims.RegisteredClaims.Subject = in.User.ID
	claims.SID = sessionID
	claims.Email = in.User.Email
	claims.Name = in.User.Name
	claims.Role = in.User.Role
	claims.Permissions = PermissionsForRole(in.User.Role)
	pair, err := s.secrets.SignTokens(ctx, claims)
	if err != nil {
		return nil, err
	}
	if _, err := s.q.CreateSession(ctx, CreateSessionParams{
		ID:               sessionID,
		UserID:           in.User.ID,
		RefreshTokenHash: HashToken(pair.RefreshToken),
		ParentSessionID:  parent,
		IPAddress:        nullStr(in.IPAddress),
		UserAgent:        nullStr(in.UserAgent),
		ExpiresAt:        time.Now().UTC().Add(time.Duration(RefreshTTLSeconds) * time.Second),
	}); err != nil {
		return nil, err
	}
	return &IssueSessionResult{SessionID: sessionID, Tokens: pair}, nil
}

func (s *Service) Refresh(ctx context.Context, refreshToken, ip, ua string) (*IssueSessionResult, error) {
	claims, err := s.secrets.Verify(ctx, refreshToken)
	if err != nil {
		return nil, apperr.Unauthorized("invalid refresh token")
	}
	if claims.TokenType != "refresh" || claims.SID == "" || claims.RegisteredClaims.Subject == "" {
		return nil, apperr.Unauthorized("invalid refresh token")
	}
	hash := HashToken(refreshToken)
	session, err := s.q.GetSessionByTokenHash(ctx, hash)
	if err != nil {
		var ae apperr.AppError
		if errors.As(err, &ae) && ae.Status == 404 {
			return nil, apperr.Unauthorized("invalid refresh token")
		}
		return nil, err
	}
	if session.UserID != claims.RegisteredClaims.Subject || session.ID != claims.SID {
		return nil, apperr.Unauthorized("invalid refresh token")
	}
	if session.RevokedAt.Valid {
		chain, err := s.collectChain(ctx, session.ID)
		if err == nil {
			_ = s.q.RevokeSessionChain(ctx, chain)
		}
		return nil, apperr.Unauthorized("token_replay_detected")
	}
	if !session.ExpiresAt.After(time.Now().UTC()) {
		return nil, apperr.Unauthorized("refresh token expired")
	}
	user, err := s.q.GetUserByID(ctx, session.UserID)
	if err != nil {
		return nil, apperr.Unauthorized("user not found")
	}
	result, err := s.issueRotated(ctx, IssueSessionInput{User: user, IPAddress: ip, UserAgent: ua}, sql.NullString{Valid: true, String: session.ID})
	if err != nil {
		return nil, err
	}
	if err := s.q.RevokeSession(ctx, session.ID); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) collectChain(ctx context.Context, sessionID string) ([]string, error) {
	seen := map[string]struct{}{}
	ancestors, err := s.q.GetSessionAncestors(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	for _, id := range ancestors {
		seen[id] = struct{}{}
	}
	root := sessionID
	if len(ancestors) > 0 {
		root = ancestors[len(ancestors)-1]
	}
	descendants, err := s.q.GetSessionDescendants(ctx, root)
	if err != nil {
		return nil, err
	}
	for _, id := range descendants {
		seen[id] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for id := range seen {
		out = append(out, id)
	}
	return out, nil
}
