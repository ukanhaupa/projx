package authservice

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"

	"projx.local/go/internal/serviceconfig"
)

const credEncryptionKey = "CRED_ENCRYPTION_KEY"

type Cipher struct {
	cfg *serviceconfig.Service
}

func NewCipher(cfg *serviceconfig.Service) *Cipher {
	return &Cipher{cfg: cfg}
}

func (c *Cipher) key(_ context.Context) ([]byte, error) {
	raw := strings.TrimSpace(os.Getenv(credEncryptionKey))
	if raw == "" {
		return nil, fmt.Errorf("auth: %s is required", credEncryptionKey)
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("auth: %s base64 decode: %w", credEncryptionKey, err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("auth: %s must decode to 32 bytes", credEncryptionKey)
	}
	return key, nil
}

func (c *Cipher) Encrypt(ctx context.Context, plaintext string) (string, error) {
	key, err := c.key(ctx)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ct), nil
}

func (c *Cipher) Decrypt(ctx context.Context, encoded string) (string, error) {
	if encoded == "" {
		return "", errors.New("auth: empty ciphertext")
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	key, err := c.key(ctx)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("auth: ciphertext too short")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}
