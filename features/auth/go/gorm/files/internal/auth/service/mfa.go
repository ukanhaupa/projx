package authservice

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	MFAMaxAttempts     = 5
	MFALockoutMinutes  = 15
	recoveryCodeCount  = 10
	recoveryAlphabet   = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	totpDigits         = 6
	totpStepSeconds    = 30
	totpWindow         = 3
	mfaSecretByteCount = 20
)

func MFAIssuer() string {
	v := strings.TrimSpace(os.Getenv("MFA_ISSUER"))
	if v == "" {
		return "projx"
	}
	return v
}

func GenerateMFASecret() (string, error) {
	buf := make([]byte, mfaSecretByteCount)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf), nil
}

func BuildOTPAuthURL(email, secret string) string {
	issuer := MFAIssuer()
	label := url.PathEscape(issuer + ":" + email)
	q := url.Values{}
	q.Set("secret", secret)
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", fmt.Sprintf("%d", totpDigits))
	q.Set("period", fmt.Sprintf("%d", totpStepSeconds))
	return "otpauth://totp/" + label + "?" + q.Encode()
}

func hotp(secret []byte, counter uint64) string {
	mac := hmac.New(sha1.New, secret)
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, counter)
	mac.Write(buf)
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	binary.BigEndian.Uint32(sum[offset : offset+4])
	code := (binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff) % uint32(pow10(totpDigits))
	return fmt.Sprintf("%0*d", totpDigits, code)
}

func pow10(n int) int {
	v := 1
	for i := 0; i < n; i++ {
		v *= 10
	}
	return v
}

func VerifyTOTP(code, secret string) bool {
	cleaned := strings.TrimSpace(code)
	if cleaned == "" || secret == "" {
		return false
	}
	raw, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(strings.ReplaceAll(secret, " ", "")))
	if err != nil {
		return false
	}
	now := time.Now().Unix() / totpStepSeconds
	for offset := -totpWindow; offset <= totpWindow; offset++ {
		counter := uint64(int64(now) + int64(offset))
		if hmac.Equal([]byte(hotp(raw, counter)), []byte(cleaned)) {
			return true
		}
	}
	return false
}

func GenerateRecoveryCodes() ([]string, error) {
	out := make([]string, recoveryCodeCount)
	for i := 0; i < recoveryCodeCount; i++ {
		left, err := pickChars(4)
		if err != nil {
			return nil, err
		}
		right, err := pickChars(4)
		if err != nil {
			return nil, err
		}
		out[i] = left + "-" + right
	}
	return out, nil
}

func pickChars(n int) (string, error) {
	alpha := []byte(recoveryAlphabet)
	max := big.NewInt(int64(len(alpha)))
	buf := make([]byte, n)
	for i := 0; i < n; i++ {
		idx, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		buf[i] = alpha[idx.Int64()]
	}
	return string(buf), nil
}

func denormalizeRecoveryCode(code string) string {
	stripped := strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(code), " ", ""), "-", ""))
	if len(stripped) < 5 {
		return stripped
	}
	return stripped[:4] + "-" + stripped[4:]
}

func HashRecoveryCodes(codes []string) ([]string, error) {
	out := make([]string, len(codes))
	for i, c := range codes {
		h, err := HashPassword(denormalizeRecoveryCode(c))
		if err != nil {
			return nil, err
		}
		out[i] = h
	}
	return out, nil
}

func MatchRecoveryCode(input string, hashes []string) int {
	normalized := denormalizeRecoveryCode(input)
	for i, h := range hashes {
		if VerifyPassword(normalized, h) {
			return i
		}
	}
	return -1
}

type recoveryEnvelope struct {
	Hashes []string `json:"hashes"`
}

func EncodeRecoveryHashes(hashes []string) (string, error) {
	buf, err := json.Marshal(recoveryEnvelope{Hashes: hashes})
	if err != nil {
		return "", err
	}
	return string(buf), nil
}

func DecodeRecoveryHashes(payload string) []string {
	if payload == "" {
		return nil
	}
	var env recoveryEnvelope
	if err := json.Unmarshal([]byte(payload), &env); err != nil {
		return nil
	}
	return env.Hashes
}

func EncodeMFASecret(secret string) (string, error) {
	buf, err := json.Marshal(map[string]string{"secret": secret})
	if err != nil {
		return "", err
	}
	return string(buf), nil
}

func DecodeMFASecret(payload string) (string, error) {
	if payload == "" {
		return "", errors.New("mfa secret missing")
	}
	var m map[string]string
	if err := json.Unmarshal([]byte(payload), &m); err != nil {
		return "", err
	}
	v, ok := m["secret"]
	if !ok || v == "" {
		return "", errors.New("mfa secret payload malformed")
	}
	return v, nil
}

func IsMFALocked(lockedUntil *time.Time) bool {
	if lockedUntil == nil {
		return false
	}
	return lockedUntil.After(time.Now().UTC())
}
