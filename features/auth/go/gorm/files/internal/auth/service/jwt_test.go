package authservice

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPermissionsForRole(t *testing.T) {
	assert.Equal(t, []string{"*:*.*"}, PermissionsForRole("admin"))
	assert.Equal(t, []string{"*:read.*"}, PermissionsForRole("user"))
	assert.Equal(t, []string{}, PermissionsForRole("unknown"))
}

func TestSignerIssueAndVerifyRefresh(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-test-secret")
	s := NewSigner(nil)
	pair, err := s.IssueTokens(context.Background(), TokenPayload{
		Sub:   "user-1",
		SID:   "session-1",
		Email: "u@example.com",
		Name:  "U",
		Role:  "user",
	})
	require.NoError(t, err)
	require.NotEmpty(t, pair.AccessToken)
	require.NotEmpty(t, pair.RefreshToken)
	claims, err := s.VerifyRefreshToken(context.Background(), pair.RefreshToken)
	require.NoError(t, err)
	assert.Equal(t, "refresh", claims["token_type"])
	assert.Equal(t, "user-1", claims["sub"])
	assert.Equal(t, "session-1", claims["sid"])
}

func TestSignerSignMFAChallengeRoundtrip(t *testing.T) {
	t.Setenv("JWT_SECRET", "challenge-secret")
	s := NewSigner(nil)
	tok, err := s.SignMFAChallenge(context.Background(), "u")
	require.NoError(t, err)
	claims, err := s.VerifyMFAChallenge(context.Background(), tok)
	require.NoError(t, err)
	assert.Equal(t, "mfa_pending", claims["stage"])
}

func TestSignerMissingSecret(t *testing.T) {
	t.Setenv("JWT_SECRET", "")
	s := NewSigner(nil)
	_, err := s.IssueTokens(context.Background(), TokenPayload{Sub: "u"})
	assert.Error(t, err)
}

func TestVerifyRefreshTokenRejectsBogus(t *testing.T) {
	t.Setenv("JWT_SECRET", "secret-value")
	s := NewSigner(nil)
	_, err := s.VerifyRefreshToken(context.Background(), "not.a.token")
	assert.Error(t, err)
}
