package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
)

const (
	ivLen  = 12
	tagLen = 16
	keyLen = 32
)

var (
	errDecrypt = errors.New("decrypt failed")
	errEncrypt = errors.New("encrypt failed")
)

func ParseKey(raw string) ([]byte, error) {
	if raw == "" {
		return nil, errors.New("CRED_ENCRYPTION_KEY is empty")
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("CRED_ENCRYPTION_KEY is not valid base64: %w", err)
	}
	if len(key) != keyLen {
		return nil, fmt.Errorf("CRED_ENCRYPTION_KEY must decode to %d bytes (got %d)", keyLen, len(key))
	}
	return key, nil
}

func Encrypt(plaintext string, key []byte) (string, error) {
	if len(key) != keyLen {
		return "", errEncrypt
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", errEncrypt
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, ivLen)
	if err != nil {
		return "", errEncrypt
	}
	iv := make([]byte, ivLen)
	if _, err := rand.Read(iv); err != nil {
		return "", errEncrypt
	}
	sealed := gcm.Seal(nil, iv, []byte(plaintext), nil)
	if len(sealed) < tagLen {
		return "", errEncrypt
	}
	ct := sealed[:len(sealed)-tagLen]
	tag := sealed[len(sealed)-tagLen:]
	buf := make([]byte, 0, ivLen+tagLen+len(ct))
	buf = append(buf, iv...)
	buf = append(buf, tag...)
	buf = append(buf, ct...)
	return base64.StdEncoding.EncodeToString(buf), nil
}

func Decrypt(payload string, key []byte) (string, error) {
	if len(key) != keyLen {
		return "", errDecrypt
	}
	buf, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", errDecrypt
	}
	if len(buf) < ivLen+tagLen {
		return "", errDecrypt
	}
	iv := buf[:ivLen]
	tag := buf[ivLen : ivLen+tagLen]
	ct := buf[ivLen+tagLen:]

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", errDecrypt
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, ivLen)
	if err != nil {
		return "", errDecrypt
	}
	plain, err := gcm.Open(nil, iv, append(append([]byte{}, ct...), tag...), nil)
	if err != nil {
		return "", errDecrypt
	}
	return string(plain), nil
}
