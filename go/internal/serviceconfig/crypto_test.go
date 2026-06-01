package serviceconfig

import (
	"encoding/base64"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var testKey = func() []byte {
	k := make([]byte, 32)
	for i := range k {
		k[i] = byte(i)
	}
	return k
}()

func TestEncryptDecryptRoundTrip(t *testing.T) {
	pt := "hello-world"
	ct, err := encrypt(testKey, pt)
	require.NoError(t, err)
	assert.NotEqual(t, pt, ct)

	got, err := decrypt(testKey, ct)
	require.NoError(t, err)
	assert.Equal(t, pt, got)
}

func TestEncryptProducesDistinctCiphertextForSameInput(t *testing.T) {
	a, err := encrypt(testKey, "same-input")
	require.NoError(t, err)
	b, err := encrypt(testKey, "same-input")
	require.NoError(t, err)
	assert.NotEqual(t, a, b)
}

func TestDecryptRejectsTamperedCiphertext(t *testing.T) {
	ct, err := encrypt(testKey, "secret")
	require.NoError(t, err)
	buf, err := base64.StdEncoding.DecodeString(ct)
	require.NoError(t, err)
	buf[len(buf)-1] ^= 1
	_, err = decrypt(testKey, base64.StdEncoding.EncodeToString(buf))
	require.Error(t, err)
}

func TestDecryptRejectsShortCiphertext(t *testing.T) {
	_, err := decrypt(testKey, base64.StdEncoding.EncodeToString(make([]byte, 10)))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "too short")
}

func TestDecryptRejectsInvalidBase64(t *testing.T) {
	_, err := decrypt(testKey, "!!!not-base64!!!")
	require.Error(t, err)
}

func TestEncryptRejectsWrongKeyLength(t *testing.T) {
	_, err := encrypt(make([]byte, 16), "x")
	require.Error(t, err)
	_, err = decrypt(make([]byte, 16), "x")
	require.Error(t, err)
}

func TestEmptyPlaintextRoundTrip(t *testing.T) {
	ct, err := encrypt(testKey, "")
	require.NoError(t, err)
	got, err := decrypt(testKey, ct)
	require.NoError(t, err)
	assert.Equal(t, "", got)
}

// Wire-format contract with fastify/express/fastapi: base64(iv[12] || tag[16] || ct[n]).
func TestWireFormatLayout(t *testing.T) {
	pt := "wire-format-fixture"
	ct, err := encrypt(testKey, pt)
	require.NoError(t, err)

	buf, err := base64.StdEncoding.DecodeString(ct)
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(buf), ivLen+tagLen)
	assert.Equal(t, ivLen+tagLen+len(pt), len(buf), "GCM ciphertext length must equal plaintext length")

	got, err := decrypt(testKey, ct)
	require.NoError(t, err)
	assert.Equal(t, pt, got)
}

// NIST GCM TC13 (zero32 key, zero12 iv, empty pt) — locks the iv||tag||ct layout.
func TestDecryptNistVector(t *testing.T) {
	key := make([]byte, 32)
	iv := make([]byte, 12)
	tagHex := "530f8afbc74536b9a963b4f1c4cb738b"
	tag, err := hex.DecodeString(tagHex)
	require.NoError(t, err)

	envelope := make([]byte, 0, ivLen+tagLen)
	envelope = append(envelope, iv...)
	envelope = append(envelope, tag...)
	payload := base64.StdEncoding.EncodeToString(envelope)

	pt, err := decrypt(key, payload)
	require.NoError(t, err)
	assert.Equal(t, "", pt)
}

func TestNistVectorRoundTrip(t *testing.T) {
	key := make([]byte, 32)
	ct, err := encrypt(key, "")
	require.NoError(t, err)
	buf, err := base64.StdEncoding.DecodeString(ct)
	require.NoError(t, err)
	assert.Len(t, buf, ivLen+tagLen)
	pt, err := decrypt(key, ct)
	require.NoError(t, err)
	assert.Equal(t, "", pt)
}

func TestDecryptRejectsTruncatedTag(t *testing.T) {
	ct, err := encrypt(testKey, "abc")
	require.NoError(t, err)
	buf, err := base64.StdEncoding.DecodeString(ct)
	require.NoError(t, err)
	_, err = decrypt(testKey, base64.StdEncoding.EncodeToString(buf[:ivLen+tagLen-1]))
	require.Error(t, err)
}

func TestLargePlaintextRoundTrip(t *testing.T) {
	pt := strings.Repeat("A", 4096)
	ct, err := encrypt(testKey, pt)
	require.NoError(t, err)
	got, err := decrypt(testKey, ct)
	require.NoError(t, err)
	assert.Equal(t, pt, got)
}
