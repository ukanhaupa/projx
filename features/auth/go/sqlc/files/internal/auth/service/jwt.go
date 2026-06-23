package authservice

import (
	"context"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"projx.local/go/internal/uuid"
)

const (
	AccessTTLSeconds       = 15 * 60
	RefreshTTLSeconds      = 7 * 24 * 60 * 60
	MFAChallengeTTLSeconds = 5 * 60
	MaxRotationAttempts    = 3
)

type Claims struct {
	jwt.RegisteredClaims
	SID         string   `json:"sid,omitempty"`
	Email       string   `json:"email,omitempty"`
	Name        string   `json:"name,omitempty"`
	Role        string   `json:"role,omitempty"`
	Permissions []string `json:"permissions,omitempty"`
	TokenType   string   `json:"token_type,omitempty"`
	Stage       string   `json:"stage,omitempty"`
}

type TokenPair struct {
	Token        string `json:"token"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	AccessJTI    string `json:"-"`
	RefreshJTI   string `json:"-"`
}

func PermissionsForRole(role string) []string {
	switch role {
	case "admin":
		return []string{"*:*.*"}
	default:
		return []string{"*:read.*"}
	}
}

func (s *Secrets) signClaims(ctx context.Context, claims Claims, ttl time.Duration) (string, error) {
	cfg, err := s.JWT(ctx)
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	claims.RegisteredClaims.IssuedAt = jwt.NewNumericDate(now)
	claims.RegisteredClaims.ExpiresAt = jwt.NewNumericDate(now.Add(ttl))
	if cfg.Issuer != "" {
		claims.RegisteredClaims.Issuer = cfg.Issuer
	}
	if cfg.Audience != "" {
		claims.RegisteredClaims.Audience = jwt.ClaimStrings{cfg.Audience}
	}
	method := jwt.GetSigningMethod(cfg.Algorithm)
	if method == nil {
		return "", errors.New("unsupported JWT algorithm: " + cfg.Algorithm)
	}
	t := jwt.NewWithClaims(method, claims)
	return t.SignedString([]byte(cfg.Secret))
}

func (s *Secrets) Verify(ctx context.Context, token string) (*Claims, error) {
	cfg, err := s.JWT(ctx)
	if err != nil {
		return nil, err
	}
	parsed, err := jwt.ParseWithClaims(token, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		if t.Method.Alg() != cfg.Algorithm {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(cfg.Secret), nil
	}, jwt.WithValidMethods([]string{cfg.Algorithm}))
	if err != nil {
		return nil, err
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

func (s *Secrets) SignMFAChallenge(ctx context.Context, userID string) (string, error) {
	return s.signClaims(ctx, Claims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: userID},
		Stage:            "mfa_pending",
	}, time.Duration(MFAChallengeTTLSeconds)*time.Second)
}

func (s *Secrets) SignTokens(ctx context.Context, payload Claims) (*TokenPair, error) {
	accessJTI := uuid.V4()
	refreshJTI := uuid.V4()
	access := payload
	access.RegisteredClaims.ID = accessJTI
	access.TokenType = "access"
	accessTok, err := s.signClaims(ctx, access, time.Duration(AccessTTLSeconds)*time.Second)
	if err != nil {
		return nil, err
	}
	refresh := payload
	refresh.RegisteredClaims.ID = refreshJTI
	refresh.TokenType = "refresh"
	refreshTok, err := s.signClaims(ctx, refresh, time.Duration(RefreshTTLSeconds)*time.Second)
	if err != nil {
		return nil, err
	}
	return &TokenPair{
		Token: accessTok, AccessToken: accessTok, RefreshToken: refreshTok,
		AccessJTI: accessJTI, RefreshJTI: refreshJTI,
	}, nil
}
