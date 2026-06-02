package authservice

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHashAndVerifyPassword(t *testing.T) {
	hash, err := HashPassword("correct-horse")
	require.NoError(t, err)
	assert.True(t, VerifyPassword("correct-horse", hash))
	assert.False(t, VerifyPassword("wrong", hash))
	assert.False(t, VerifyPassword("correct-horse", ""))
	assert.False(t, VerifyPassword("correct-horse", "$argon2id$broken"))
}

func TestHashTokenStable(t *testing.T) {
	a := HashToken("abc")
	b := HashToken("abc")
	assert.Equal(t, a, b)
	assert.NotEqual(t, HashToken("abc"), HashToken("abd"))
	assert.Len(t, a, 64)
}

func TestRandomTokenLength(t *testing.T) {
	tok, err := RandomToken()
	require.NoError(t, err)
	assert.Len(t, tok, 64)
}
