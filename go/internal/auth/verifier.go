package auth

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"

	"projx.local/go/internal/apperr"
)

type Provider string

const (
	ProviderSharedSecret Provider = "shared_secret"
	ProviderJWKS         Provider = "jwks"
)

type Config struct {
	Provider   Provider
	Secret     []byte
	JWKSURL    string
	Algorithms []string
	Issuer     string
	Audience   string
}

type Claims struct {
	jwt.RegisteredClaims
	Email       string   `json:"email,omitempty"`
	Role        string   `json:"role,omitempty"`
	Permissions []string `json:"permissions,omitempty"`
	SID         string   `json:"sid,omitempty"`
}

type Verifier struct {
	cfg     Config
	keyfunc jwt.Keyfunc
	parser  *jwt.Parser
}

func NewVerifier(cfg Config) (*Verifier, error) {
	if cfg.Provider == "" {
		return nil, fmt.Errorf("auth: JWT_PROVIDER is required (shared_secret or jwks)")
	}
	if len(cfg.Algorithms) == 0 {
		return nil, fmt.Errorf("auth: at least one algorithm is required")
	}

	parserOpts := []jwt.ParserOption{jwt.WithValidMethods(cfg.Algorithms)}
	if cfg.Issuer != "" {
		parserOpts = append(parserOpts, jwt.WithIssuer(cfg.Issuer))
	}
	if cfg.Audience != "" {
		parserOpts = append(parserOpts, jwt.WithAudience(cfg.Audience))
	}

	v := &Verifier{cfg: cfg, parser: jwt.NewParser(parserOpts...)}

	switch cfg.Provider {
	case ProviderSharedSecret:
		if len(cfg.Secret) == 0 {
			return nil, fmt.Errorf("auth: JWT_SECRET is required when provider=shared_secret")
		}
		secret := cfg.Secret
		v.keyfunc = func(_ *jwt.Token) (any, error) { return secret, nil }
	case ProviderJWKS:
		if cfg.JWKSURL == "" {
			return nil, fmt.Errorf("auth: JWT_JWKS_URL is required when provider=jwks")
		}
		kf, err := keyfunc.NewDefaultCtx(context.Background(), []string{cfg.JWKSURL})
		if err != nil {
			return nil, fmt.Errorf("auth: failed to initialize JWKS keyfunc: %w", err)
		}
		v.keyfunc = kf.Keyfunc
	default:
		return nil, fmt.Errorf("auth: unsupported provider %q (use shared_secret or jwks)", cfg.Provider)
	}

	return v, nil
}

func NewVerifierFromEnv() (*Verifier, error) {
	provider := strings.TrimSpace(os.Getenv("JWT_PROVIDER"))
	if provider == "" {
		if strings.TrimSpace(os.Getenv("JWT_JWKS_URL")) != "" {
			provider = string(ProviderJWKS)
		} else {
			provider = string(ProviderSharedSecret)
		}
	}

	cfg := Config{
		Provider: Provider(provider),
		Issuer:   strings.TrimSpace(os.Getenv("JWT_ISSUER")),
		Audience: strings.TrimSpace(os.Getenv("JWT_AUDIENCE")),
	}

	if raw := strings.TrimSpace(os.Getenv("JWT_ALGORITHMS")); raw != "" {
		for _, a := range strings.Split(raw, ",") {
			if a = strings.TrimSpace(a); a != "" {
				cfg.Algorithms = append(cfg.Algorithms, a)
			}
		}
	}
	if len(cfg.Algorithms) == 0 {
		if cfg.Provider == ProviderSharedSecret {
			cfg.Algorithms = []string{"HS256"}
		} else {
			cfg.Algorithms = []string{"RS256"}
		}
	}

	switch cfg.Provider {
	case ProviderSharedSecret:
		secret := os.Getenv("JWT_SECRET")
		if secret == "" {
			return nil, fmt.Errorf("auth: JWT_SECRET is required when JWT_PROVIDER=shared_secret")
		}
		cfg.Secret = []byte(secret)
	case ProviderJWKS:
		cfg.JWKSURL = strings.TrimSpace(os.Getenv("JWT_JWKS_URL"))
	}

	return NewVerifier(cfg)
}

func (v *Verifier) VerifyToken(_ context.Context, token string) (*Claims, error) {
	if token == "" {
		return nil, apperr.Unauthorized("missing bearer token")
	}

	claims := &Claims{}
	parsed, err := v.parser.ParseWithClaims(token, claims, v.keyfunc)
	if err != nil {
		return nil, mapJWTError(err)
	}
	if !parsed.Valid {
		return nil, apperr.Unauthorized("invalid or expired token")
	}
	if claims.Subject == "" {
		return nil, apperr.Unauthorized("invalid token payload")
	}
	return claims, nil
}

func mapJWTError(err error) error {
	switch {
	case errors.Is(err, jwt.ErrTokenExpired):
		return apperr.Unauthorized("token expired")
	case errors.Is(err, jwt.ErrTokenNotValidYet), errors.Is(err, jwt.ErrTokenUsedBeforeIssued):
		return apperr.Unauthorized("token not yet valid")
	case errors.Is(err, jwt.ErrTokenInvalidIssuer):
		return apperr.Unauthorized("invalid token issuer")
	case errors.Is(err, jwt.ErrTokenInvalidAudience):
		return apperr.Unauthorized("invalid token audience")
	case errors.Is(err, jwt.ErrTokenSignatureInvalid):
		return apperr.Unauthorized("invalid token signature")
	case errors.Is(err, jwt.ErrTokenMalformed):
		return apperr.Unauthorized("malformed token")
	case errors.Is(err, jwt.ErrTokenRequiredClaimMissing):
		return apperr.Unauthorized("token missing required claim")
	}
	return apperr.Unauthorized("invalid or expired token")
}
