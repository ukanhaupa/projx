package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"io"
	"strings"
	"testing"
)

func encryptNodeFormat(t *testing.T, key []byte, plaintext string) string {
	t.Helper()
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	iv := make([]byte, 12)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		t.Fatalf("iv: %v", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 12)
	if err != nil {
		t.Fatalf("gcm: %v", err)
	}
	sealed := gcm.Seal(nil, iv, []byte(plaintext), nil)
	ct := sealed[:len(sealed)-16]
	tag := sealed[len(sealed)-16:]
	payload := append(append(append([]byte{}, iv...), tag...), ct...)
	return base64.StdEncoding.EncodeToString(payload)
}

func newKey(t *testing.T) []byte {
	t.Helper()
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		t.Fatalf("key: %v", err)
	}
	return key
}

func TestDecryptRoundTrip(t *testing.T) {
	key := newKey(t)
	payload := encryptNodeFormat(t, key, "smtp-password-42")
	got, err := Decrypt(payload, key)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got != "smtp-password-42" {
		t.Fatalf("round-trip mismatch: got %q", got)
	}
}

func TestDecryptMatchesNodeFixture(t *testing.T) {
	key, err := base64.StdEncoding.DecodeString("Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMTI=")
	if err != nil {
		t.Fatalf("key decode: %v", err)
	}
	if len(key) != 32 {
		t.Fatalf("fixture key must be 32 bytes, got %d", len(key))
	}
	const payload = "MDEyMzQ1Njc4OWFivZc0A6M7CcTc4c+bwaLxsCd1GCGTzuEtuhNfKeWbeN88"
	got, err := Decrypt(payload, key)
	if err != nil {
		t.Fatalf("decrypt node fixture: %v", err)
	}
	if got != "hunter2-smtp-pass" {
		t.Fatalf("node fixture plaintext = %q, want hunter2-smtp-pass", got)
	}
}

func TestDecryptRejectsWrongKey(t *testing.T) {
	payload := encryptNodeFormat(t, newKey(t), "topsecret")
	if _, err := Decrypt(payload, newKey(t)); err == nil {
		t.Fatal("decrypt with a different key must fail")
	}
}

func TestDecryptRejectsGarbage(t *testing.T) {
	key := newKey(t)
	if _, err := Decrypt("!!!not base64!!!", key); err == nil {
		t.Fatal("decrypt must reject non-base64 input")
	}
	if _, err := Decrypt(base64.StdEncoding.EncodeToString([]byte("short")), key); err == nil {
		t.Fatal("decrypt must reject a too-short payload")
	}
}

func TestDecryptRejectsBadKeyLength(t *testing.T) {
	payload := encryptNodeFormat(t, newKey(t), "x")
	if _, err := Decrypt(payload, []byte("not-32-bytes")); err == nil {
		t.Fatal("decrypt must reject a key that is not 32 bytes")
	}
}

func TestParseKey(t *testing.T) {
	raw := base64.StdEncoding.EncodeToString(make([]byte, 32))
	key, err := ParseKey(raw)
	if err != nil {
		t.Fatalf("ParseKey: %v", err)
	}
	if len(key) != 32 {
		t.Fatalf("ParseKey length = %d, want 32", len(key))
	}
	if _, err := ParseKey(""); err == nil {
		t.Fatal("empty key must error")
	}
	if _, err := ParseKey(base64.StdEncoding.EncodeToString(make([]byte, 16))); err == nil {
		t.Fatal("16-byte key must error")
	}
	if _, err := ParseKey("not base64 @@@"); err == nil {
		t.Fatal("non-base64 key must error")
	}
}

func TestDecryptDoesNotLeakViaError(t *testing.T) {
	key := newKey(t)
	payload := encryptNodeFormat(t, key, "super-secret-plaintext")
	_, err := Decrypt(payload, newKey(t))
	if err == nil {
		t.Fatal("expected error")
	}
	if strings.Contains(err.Error(), "super-secret-plaintext") {
		t.Fatal("error message must not contain plaintext")
	}
}

func decryptNodeFormat(t *testing.T, key []byte, payload string) string {
	t.Helper()
	buf, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		t.Fatalf("b64: %v", err)
	}
	if len(buf) < 28 {
		t.Fatalf("payload too short: %d", len(buf))
	}
	iv, tag, ct := buf[:12], buf[12:28], buf[28:]
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 12)
	if err != nil {
		t.Fatalf("gcm: %v", err)
	}
	plain, err := gcm.Open(nil, iv, append(append([]byte{}, ct...), tag...), nil)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	return string(plain)
}

func TestEncryptRoundTrip(t *testing.T) {
	key := newKey(t)
	payload, err := Encrypt("jwt-secret-99", key)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	got, err := Decrypt(payload, key)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got != "jwt-secret-99" {
		t.Fatalf("round-trip mismatch: got %q", got)
	}
}

func TestEncryptIsBackendReadable(t *testing.T) {
	key := newKey(t)
	const plain = `{"host":"smtp.example.com","port":587}`
	payload, err := Encrypt(plain, key)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if got := decryptNodeFormat(t, key, payload); got != plain {
		t.Fatalf("backend reader mismatch: got %q", got)
	}
}

func TestEncryptUsesFreshIV(t *testing.T) {
	key := newKey(t)
	a, err := Encrypt("same", key)
	if err != nil {
		t.Fatalf("encrypt a: %v", err)
	}
	b, err := Encrypt("same", key)
	if err != nil {
		t.Fatalf("encrypt b: %v", err)
	}
	if a == b {
		t.Fatal("Encrypt must use a fresh IV per call; outputs were identical")
	}
}

func TestEncryptRejectsBadKeyLength(t *testing.T) {
	if _, err := Encrypt("x", []byte("not-32-bytes")); err == nil {
		t.Fatal("Encrypt must reject a key that is not 32 bytes")
	}
}
