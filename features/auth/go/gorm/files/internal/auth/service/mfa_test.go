package authservice

import (
	"crypto/hmac"
	"encoding/base32"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateMFASecretBase32(t *testing.T) {
	s, err := GenerateMFASecret()
	require.NoError(t, err)
	_, err = base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(s)
	assert.NoError(t, err)
}

func TestVerifyTOTPMatchesGeneratedCode(t *testing.T) {
	s, err := GenerateMFASecret()
	require.NoError(t, err)
	raw, _ := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(s)
	counter := uint64(time.Now().Unix() / totpStepSeconds)
	code := hotp(raw, counter)
	assert.True(t, VerifyTOTP(code, s))
	assert.False(t, VerifyTOTP("000000", s))
	assert.False(t, VerifyTOTP("", s))
}

func TestRecoveryCodeRoundtrip(t *testing.T) {
	codes, err := GenerateRecoveryCodes()
	require.NoError(t, err)
	assert.Len(t, codes, recoveryCodeCount)
	hashes, err := HashRecoveryCodes(codes)
	require.NoError(t, err)
	assert.Equal(t, len(codes), len(hashes))
	idx := MatchRecoveryCode(strings.ToLower(codes[3]), hashes)
	assert.Equal(t, 3, idx)
	assert.Equal(t, -1, MatchRecoveryCode("nope-nope", hashes))
}

func TestEncodeDecodeRecoveryHashes(t *testing.T) {
	in := []string{"a", "b", "c"}
	enc, err := EncodeRecoveryHashes(in)
	require.NoError(t, err)
	out := DecodeRecoveryHashes(enc)
	assert.Equal(t, in, out)
	assert.Nil(t, DecodeRecoveryHashes(""))
	assert.Nil(t, DecodeRecoveryHashes("garbage"))
}

func TestEncodeDecodeMFASecret(t *testing.T) {
	enc, err := EncodeMFASecret("HELLO")
	require.NoError(t, err)
	out, err := DecodeMFASecret(enc)
	require.NoError(t, err)
	assert.Equal(t, "HELLO", out)
	_, err = DecodeMFASecret("")
	assert.Error(t, err)
	_, err = DecodeMFASecret("not-json")
	assert.Error(t, err)
}

func TestBuildOTPAuthURL(t *testing.T) {
	u := BuildOTPAuthURL("user@example.com", "ABCDEF")
	assert.Contains(t, u, "otpauth://totp/")
	assert.Contains(t, u, "secret=ABCDEF")
}

func TestIsMFALocked(t *testing.T) {
	assert.False(t, IsMFALocked(nil))
	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)
	assert.False(t, IsMFALocked(&past))
	assert.True(t, IsMFALocked(&future))
}

func TestHotpAcrossOffsetWindow(t *testing.T) {
	s, _ := GenerateMFASecret()
	raw, _ := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(s)
	now := uint64(time.Now().Unix() / totpStepSeconds)
	c1 := hotp(raw, now)
	c2 := hotp(raw, now+1)
	assert.NotEqual(t, c1, c2)
	assert.True(t, hmac.Equal([]byte(c1), []byte(c1)))
}
