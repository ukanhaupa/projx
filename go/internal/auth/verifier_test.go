package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"projx.local/go/internal/apperr"
)

const testSecret = "super-secret-test-key-do-not-use"

func newHS256Verifier(t *testing.T) *Verifier {
	t.Helper()
	v, err := NewVerifier(Config{
		Provider:   ProviderSharedSecret,
		Secret:     []byte(testSecret),
		Algorithms: []string{"HS256"},
	})
	require.NoError(t, err)
	return v
}

func signHS256(t *testing.T, claims jwt.Claims, secret string) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString([]byte(secret))
	require.NoError(t, err)
	return signed
}

func signRS256(t *testing.T, claims jwt.Claims) (string, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := tok.SignedString(key)
	require.NoError(t, err)
	return signed, key
}

func TestNewVerifierRejectsEmptyProvider(t *testing.T) {
	_, err := NewVerifier(Config{Algorithms: []string{"HS256"}, Secret: []byte("x")})
	require.Error(t, err)
}

func TestNewVerifierRejectsUnknownProvider(t *testing.T) {
	_, err := NewVerifier(Config{Provider: "unknown", Algorithms: []string{"HS256"}})
	require.Error(t, err)
}

func TestNewVerifierRejectsMissingAlgorithms(t *testing.T) {
	_, err := NewVerifier(Config{Provider: ProviderSharedSecret, Secret: []byte("x")})
	require.Error(t, err)
}

func TestNewVerifierRejectsSharedSecretWithoutSecret(t *testing.T) {
	_, err := NewVerifier(Config{Provider: ProviderSharedSecret, Algorithms: []string{"HS256"}})
	require.Error(t, err)
}

func TestNewVerifierRejectsJWKSWithoutURL(t *testing.T) {
	_, err := NewVerifier(Config{Provider: ProviderJWKS, Algorithms: []string{"RS256"}})
	require.Error(t, err)
}

func TestVerifyTokenHS256HappyPath(t *testing.T) {
	v := newHS256Verifier(t)
	token := signHS256(t, jwt.MapClaims{
		"sub":         "user-123",
		"email":       "u@example.com",
		"role":        "admin",
		"permissions": []string{"posts:read", "posts:write"},
		"sid":         "sess-1",
		"exp":         time.Now().Add(time.Hour).Unix(),
	}, testSecret)

	claims, err := v.VerifyToken(context.Background(), token)
	require.NoError(t, err)
	assert.Equal(t, "user-123", claims.Subject)
	assert.Equal(t, "u@example.com", claims.Email)
	assert.Equal(t, "admin", claims.Role)
	assert.Equal(t, []string{"posts:read", "posts:write"}, claims.Permissions)
	assert.Equal(t, "sess-1", claims.SID)
}

func TestVerifyTokenRejectsEmptyString(t *testing.T) {
	v := newHS256Verifier(t)
	_, err := v.VerifyToken(context.Background(), "")
	require.Error(t, err)
	var ae apperr.AppError
	require.ErrorAs(t, err, &ae)
	assert.Equal(t, http.StatusUnauthorized, ae.Status)
}

func TestVerifyTokenRejectsWrongSecret(t *testing.T) {
	v := newHS256Verifier(t)
	token := signHS256(t, jwt.MapClaims{
		"sub": "user-123",
		"exp": time.Now().Add(time.Hour).Unix(),
	}, "different-secret")

	_, err := v.VerifyToken(context.Background(), token)
	require.Error(t, err)
	var ae apperr.AppError
	require.ErrorAs(t, err, &ae)
	assert.Equal(t, http.StatusUnauthorized, ae.Status)
}

func TestVerifyTokenRejectsExpired(t *testing.T) {
	v := newHS256Verifier(t)
	token := signHS256(t, jwt.MapClaims{
		"sub": "user-123",
		"exp": time.Now().Add(-time.Hour).Unix(),
	}, testSecret)

	_, err := v.VerifyToken(context.Background(), token)
	require.Error(t, err)
	var ae apperr.AppError
	require.ErrorAs(t, err, &ae)
	assert.Equal(t, http.StatusUnauthorized, ae.Status)
	assert.Equal(t, "token expired", ae.Detail)
}

func TestVerifyTokenRejectsMalformed(t *testing.T) {
	v := newHS256Verifier(t)
	_, err := v.VerifyToken(context.Background(), "not-a-jwt")
	require.Error(t, err)
	var ae apperr.AppError
	require.ErrorAs(t, err, &ae)
	assert.Equal(t, http.StatusUnauthorized, ae.Status)
}

func TestVerifyTokenRejectsMissingSubject(t *testing.T) {
	v := newHS256Verifier(t)
	token := signHS256(t, jwt.MapClaims{
		"email": "u@example.com",
		"exp":   time.Now().Add(time.Hour).Unix(),
	}, testSecret)

	_, err := v.VerifyToken(context.Background(), token)
	require.Error(t, err)
	var ae apperr.AppError
	require.ErrorAs(t, err, &ae)
	assert.Equal(t, http.StatusUnauthorized, ae.Status)
}

func TestVerifyTokenRejectsAlgConfusion(t *testing.T) {
	rsaToken, _ := signRS256(t, jwt.MapClaims{
		"sub": "user-123",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	v, err := NewVerifier(Config{
		Provider:   ProviderSharedSecret,
		Secret:     []byte(testSecret),
		Algorithms: []string{"HS256"},
	})
	require.NoError(t, err)

	_, err = v.VerifyToken(context.Background(), rsaToken)
	require.Error(t, err)
	var ae apperr.AppError
	require.ErrorAs(t, err, &ae)
	assert.Equal(t, http.StatusUnauthorized, ae.Status)
}

func TestVerifyTokenRejectsHS256WhenVerifierExpectsRS256(t *testing.T) {
	hsToken := signHS256(t, jwt.MapClaims{
		"sub": "user-123",
		"exp": time.Now().Add(time.Hour).Unix(),
	}, testSecret)

	v, err := NewVerifier(Config{
		Provider:   ProviderSharedSecret,
		Secret:     []byte(testSecret),
		Algorithms: []string{"RS256"},
	})
	require.NoError(t, err)

	_, err = v.VerifyToken(context.Background(), hsToken)
	require.Error(t, err)
	var ae apperr.AppError
	require.ErrorAs(t, err, &ae)
	assert.Equal(t, http.StatusUnauthorized, ae.Status)
}

func TestVerifyTokenRejectsNoneAlgorithm(t *testing.T) {
	v := newHS256Verifier(t)
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"sub": "user-123",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	signed, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	_, err = v.VerifyToken(context.Background(), signed)
	require.Error(t, err)
}

func TestVerifyTokenEnforcesIssuerWhenConfigured(t *testing.T) {
	v, err := NewVerifier(Config{
		Provider:   ProviderSharedSecret,
		Secret:     []byte(testSecret),
		Algorithms: []string{"HS256"},
		Issuer:     "https://issuer.example.com",
	})
	require.NoError(t, err)

	wrongIssuer := signHS256(t, jwt.MapClaims{
		"sub": "user-123",
		"iss": "https://other.example.com",
		"exp": time.Now().Add(time.Hour).Unix(),
	}, testSecret)
	_, err = v.VerifyToken(context.Background(), wrongIssuer)
	require.Error(t, err)

	rightIssuer := signHS256(t, jwt.MapClaims{
		"sub": "user-123",
		"iss": "https://issuer.example.com",
		"exp": time.Now().Add(time.Hour).Unix(),
	}, testSecret)
	_, err = v.VerifyToken(context.Background(), rightIssuer)
	require.NoError(t, err)
}

func TestVerifyTokenEnforcesAudienceWhenConfigured(t *testing.T) {
	v, err := NewVerifier(Config{
		Provider:   ProviderSharedSecret,
		Secret:     []byte(testSecret),
		Algorithms: []string{"HS256"},
		Audience:   "projx-api",
	})
	require.NoError(t, err)

	wrongAud := signHS256(t, jwt.MapClaims{
		"sub": "user-123",
		"aud": "other-api",
		"exp": time.Now().Add(time.Hour).Unix(),
	}, testSecret)
	_, err = v.VerifyToken(context.Background(), wrongAud)
	require.Error(t, err)
}

func TestNewVerifierFromEnvSharedSecret(t *testing.T) {
	t.Setenv("JWT_PROVIDER", "shared_secret")
	t.Setenv("JWT_SECRET", testSecret)
	t.Setenv("JWT_ALGORITHMS", "HS256")

	v, err := NewVerifierFromEnv()
	require.NoError(t, err)
	require.NotNil(t, v)

	token := signHS256(t, jwt.MapClaims{
		"sub": "user-1",
		"exp": time.Now().Add(time.Hour).Unix(),
	}, testSecret)
	claims, err := v.VerifyToken(context.Background(), token)
	require.NoError(t, err)
	assert.Equal(t, "user-1", claims.Subject)
}

func TestNewVerifierFromEnvRejectsMissingSecret(t *testing.T) {
	t.Setenv("JWT_PROVIDER", "shared_secret")
	t.Setenv("JWT_SECRET", "")

	_, err := NewVerifierFromEnv()
	require.Error(t, err)
}

func TestNewVerifierFromEnvDefaultsToSharedSecret(t *testing.T) {
	t.Setenv("JWT_PROVIDER", "")
	t.Setenv("JWT_JWKS_URL", "")
	t.Setenv("JWT_SECRET", testSecret)
	t.Setenv("JWT_ALGORITHMS", "")

	v, err := NewVerifierFromEnv()
	require.NoError(t, err)
	assert.Equal(t, ProviderSharedSecret, v.cfg.Provider)
	assert.Equal(t, []string{"HS256"}, v.cfg.Algorithms)
}

func TestNewVerifierFromEnvJWKSRequiresURL(t *testing.T) {
	t.Setenv("JWT_PROVIDER", "jwks")
	t.Setenv("JWT_JWKS_URL", "")

	_, err := NewVerifierFromEnv()
	require.Error(t, err)
}

func TestNewVerifierFromEnvDetectsJWKSFromURL(t *testing.T) {
	t.Setenv("JWT_PROVIDER", "")
	t.Setenv("JWT_JWKS_URL", "https://example.com/.well-known/jwks.json")
	t.Setenv("JWT_SECRET", "")

	v, err := NewVerifierFromEnv()
	require.NoError(t, err)
	assert.Equal(t, ProviderJWKS, v.cfg.Provider)
	assert.Equal(t, []string{"RS256"}, v.cfg.Algorithms)
}

func TestMapJWTErrorFallback(t *testing.T) {
	err := mapJWTError(errors.New("totally unknown"))
	var ae apperr.AppError
	require.ErrorAs(t, err, &ae)
	assert.Equal(t, http.StatusUnauthorized, ae.Status)
	assert.Equal(t, "invalid or expired token", ae.Detail)
}
