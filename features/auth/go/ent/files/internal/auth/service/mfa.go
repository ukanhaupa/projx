package authservice

import (
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"math/big"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/pquerna/otp/totp"
)

const (
	MFAMaxAttempts    = 5
	MFALockoutMs      = 15 * 60 * 1000
	RecoveryCodeCount = 10
	recoveryAlphabet  = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
)

func mfaIssuer() string {
	v := strings.TrimSpace(os.Getenv("MFA_ISSUER"))
	if v == "" {
		return "projx"
	}
	return v
}

func GenerateSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf), nil
}

func BuildOtpauthURL(email, secret string) string {
	u := url.URL{Scheme: "otpauth", Host: "totp"}
	u.Path = "/" + mfaIssuer() + ":" + email
	q := u.Query()
	q.Set("secret", secret)
	q.Set("issuer", mfaIssuer())
	q.Set("algorithm", "SHA1")
	q.Set("digits", "6")
	q.Set("period", "30")
	u.RawQuery = q.Encode()
	return u.String()
}

func VerifyTOTP(code, secret string) bool {
	return totp.Validate(strings.TrimSpace(code), secret)
}

func GenerateRecoveryCodes(count int) ([]string, error) {
	if count <= 0 {
		count = RecoveryCodeCount
	}
	out := make([]string, count)
	for i := 0; i < count; i++ {
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
	out := make([]byte, n)
	max := big.NewInt(int64(len(recoveryAlphabet)))
	for i := 0; i < n; i++ {
		idx, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		out[i] = recoveryAlphabet[idx.Int64()]
	}
	return string(out), nil
}

func DenormalizeRecoveryCode(code string) string {
	stripped := strings.ReplaceAll(strings.ReplaceAll(strings.ToUpper(strings.TrimSpace(code)), "-", ""), " ", "")
	if len(stripped) < 8 {
		return stripped
	}
	return stripped[:4] + "-" + stripped[4:]
}

func IsMFALocked(lockedUntil *time.Time) bool {
	if lockedUntil == nil {
		return false
	}
	return lockedUntil.After(time.Now())
}

func FormatLockoutMessage(lockedUntil time.Time, prefix string) string {
	mins := int(time.Until(lockedUntil).Round(time.Minute).Minutes())
	if mins < 1 {
		mins = 1
	}
	suffix := "s"
	if mins == 1 {
		suffix = ""
	}
	return fmt.Sprintf("%s Try again in %d minute%s.", strings.TrimSpace(prefix), mins, suffix)
}
