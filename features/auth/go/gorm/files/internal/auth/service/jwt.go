package authservice

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"projx.local/go/internal/serviceconfig"
	"projx.local/go/internal/uuid"
)

const (
	AccessTTL          = 15 * time.Minute
	RefreshTTL         = 7 * 24 * time.Hour
	MFAChallengeTTL    = 5 * time.Minute
	jwtSecretConfigKey = "jwt_secret"
)

var RolePermissions = map[string][]string{
	"admin": {"*:*.*"},
	"user":  {"*:read.*"},
}

func PermissionsForRole(role string) []string {
	perms, ok := RolePermissions[role]
	if !ok {
		return []string{}
	}
	out := make([]string, len(perms))
	copy(out, perms)
	return out
}

type TokenPair struct {
	AccessToken  string
	RefreshToken string
	AccessJTI    string
	RefreshJTI   string
}

type TokenPayload struct {
	Sub         string
	SID         string
	Email       string
	Name        string
	Role        string
	Permissions []string
}

type Signer struct {
	cfg    *serviceconfig.Service
	envKey string
}

func NewSigner(cfg *serviceconfig.Service) *Signer {
	return &Signer{cfg: cfg, envKey: "JWT_SECRET"}
}

func (s *Signer) secret(ctx context.Context) ([]byte, error) {
	if s.cfg != nil {
		if v, err := s.cfg.Get(ctx, jwtSecretConfigKey); err == nil && v != "" {
			return []byte(v), nil
		}
	}
	v := strings.TrimSpace(os.Getenv(s.envKey))
	if v == "" {
		return nil, errors.New("auth: JWT secret not configured (service_configs:jwt_secret or env JWT_SECRET)")
	}
	return []byte(v), nil
}

func (s *Signer) sign(ctx context.Context, claims jwt.MapClaims) (string, error) {
	secret, err := s.secret(ctx)
	if err != nil {
		return "", err
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString(secret)
}

func (s *Signer) IssueTokens(ctx context.Context, p TokenPayload) (*TokenPair, error) {
	now := time.Now().UTC()
	accessJTI := uuid.V4()
	refreshJTI := uuid.V4()
	base := jwt.MapClaims{
		"sub":         p.Sub,
		"sid":         p.SID,
		"email":       p.Email,
		"name":        p.Name,
		"role":        p.Role,
		"permissions": p.Permissions,
		"iat":         now.Unix(),
	}
	access := jwt.MapClaims{}
	for k, v := range base {
		access[k] = v
	}
	access["token_type"] = "access"
	access["jti"] = accessJTI
	access["exp"] = now.Add(AccessTTL).Unix()

	refresh := jwt.MapClaims{}
	for k, v := range base {
		refresh[k] = v
	}
	refresh["token_type"] = "refresh"
	refresh["jti"] = refreshJTI
	refresh["exp"] = now.Add(RefreshTTL).Unix()

	at, err := s.sign(ctx, access)
	if err != nil {
		return nil, err
	}
	rt, err := s.sign(ctx, refresh)
	if err != nil {
		return nil, err
	}
	return &TokenPair{AccessToken: at, RefreshToken: rt, AccessJTI: accessJTI, RefreshJTI: refreshJTI}, nil
}

func (s *Signer) SignMFAChallenge(ctx context.Context, userID string) (string, error) {
	now := time.Now().UTC()
	claims := jwt.MapClaims{
		"sub":   userID,
		"stage": "mfa_pending",
		"iat":   now.Unix(),
		"exp":   now.Add(MFAChallengeTTL).Unix(),
	}
	return s.sign(ctx, claims)
}

func (s *Signer) VerifyRefreshToken(ctx context.Context, token string) (jwt.MapClaims, error) {
	secret, err := s.secret(ctx)
	if err != nil {
		return nil, err
	}
	parsed, err := jwt.Parse(token, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return secret, nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return nil, err
	}
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok || !parsed.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

func (s *Signer) VerifyMFAChallenge(ctx context.Context, token string) (jwt.MapClaims, error) {
	return s.VerifyRefreshToken(ctx, token)
}
