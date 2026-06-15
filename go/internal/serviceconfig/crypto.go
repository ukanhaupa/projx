package serviceconfig

// Wire format (BIT-FOR-BIT compatible with fastify/express/fastapi siblings):
// base64( iv[12] || tag[16] || ciphertext[n] ).
// AES-256-GCM, 12-byte random IV, 16-byte auth tag.
// The 32-byte key is base64(CRED_ENCRYPTION_KEY).
// Node's GCM emits ciphertext separately from the tag (cipher.getAuthTag());
// Python's AESGCM and Go's cipher.AEAD return ciphertext||tag concatenated.
// We re-slice on encrypt and re-join on decrypt so the on-disk bytes are
// iv || tag || ct on every stack. Do not change this ordering.

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
)

const (
	ivLen  = 12
	tagLen = 16
)

func encrypt(key []byte, plaintext string) (string, error) {
	if len(key) != 32 {
		return "", fmt.Errorf("key must be 32 bytes (got %d)", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	iv := make([]byte, ivLen)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return "", err
	}
	sealed := aead.Seal(nil, iv, []byte(plaintext), nil)
	if len(sealed) < tagLen {
		return "", errors.New("sealed output shorter than tag length")
	}
	ct := sealed[:len(sealed)-tagLen]
	tag := sealed[len(sealed)-tagLen:]
	out := make([]byte, 0, ivLen+tagLen+len(ct))
	out = append(out, iv...)
	out = append(out, tag...)
	out = append(out, ct...)
	return base64.StdEncoding.EncodeToString(out), nil
}

func decrypt(key []byte, payload string) (string, error) {
	if len(key) != 32 {
		return "", fmt.Errorf("key must be 32 bytes (got %d)", len(key))
	}
	buf, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", fmt.Errorf("base64 decode: %w", err)
	}
	if len(buf) < ivLen+tagLen {
		return "", errors.New("ciphertext too short")
	}
	iv := buf[:ivLen]
	tag := buf[ivLen : ivLen+tagLen]
	ct := buf[ivLen+tagLen:]
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	sealed := make([]byte, 0, len(ct)+len(tag))
	sealed = append(sealed, ct...)
	sealed = append(sealed, tag...)
	pt, err := aead.Open(nil, iv, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("gcm open: %w", err)
	}
	return string(pt), nil
}
