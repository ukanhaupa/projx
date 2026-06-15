package authmodels

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserBeforeCreateAssignsID(t *testing.T) {
	u := &User{}
	require.NoError(t, u.BeforeCreate(nil))
	assert.Len(t, u.ID, 36)
}

func TestUserBeforeCreatePreservesID(t *testing.T) {
	u := &User{ID: "abc"}
	require.NoError(t, u.BeforeCreate(nil))
	assert.Equal(t, "abc", u.ID)
}

func TestRefreshTokenBeforeCreateAssignsID(t *testing.T) {
	r := &RefreshToken{}
	require.NoError(t, r.BeforeCreate(nil))
	assert.Len(t, r.ID, 36)
}

func TestVerificationTokenBeforeCreateAssignsID(t *testing.T) {
	v := &VerificationToken{}
	require.NoError(t, v.BeforeCreate(nil))
	assert.Len(t, v.ID, 36)
}

func TestTableNames(t *testing.T) {
	assert.Equal(t, "users", User{}.TableName())
	assert.Equal(t, "refresh_tokens", RefreshToken{}.TableName())
	assert.Equal(t, "verification_tokens", VerificationToken{}.TableName())
}

func TestTokenKindsConstants(t *testing.T) {
	assert.Equal(t, "password_reset", TokenKindPasswordReset)
	assert.Equal(t, "email_verify", TokenKindEmailVerify)
}
