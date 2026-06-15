package authservice

import (
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

var timeNow = func() time.Time { return time.Now().UTC() }

const RecoveryCodeCount = 10

func GenerateMFASecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return strings.TrimRight(base32.StdEncoding.EncodeToString(buf), "="), nil
}

func BuildOTPAuthURL(email, secret string) string {
	issuer := os.Getenv("MFA_ISSUER")
	if issuer == "" {
		issuer = "projx"
	}
	v := url.Values{}
	v.Set("secret", secret)
	v.Set("issuer", issuer)
	v.Set("algorithm", "SHA1")
	v.Set("digits", "6")
	v.Set("period", "30")
	return fmt.Sprintf("otpauth://totp/%s:%s?%s", url.PathEscape(issuer), url.PathEscape(email), v.Encode())
}

func VerifyTOTP(code, secret string) bool {
	if code == "" || secret == "" {
		return false
	}
	ok, err := totp.ValidateCustom(code, secret, timeNow(), totp.ValidateOpts{
		Period: 30, Skew: 1, Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1,
	})
	return ok && err == nil
}

func GenerateRecoveryCodes() ([]string, error) {
	out := make([]string, RecoveryCodeCount)
	for i := 0; i < RecoveryCodeCount; i++ {
		buf := make([]byte, 10)
		if _, err := rand.Read(buf); err != nil {
			return nil, err
		}
		raw := strings.TrimRight(base32.StdEncoding.EncodeToString(buf), "=")
		if len(raw) < 12 {
			raw = raw + strings.Repeat("a", 12-len(raw))
		}
		out[i] = strings.ToLower(raw[:4] + "-" + raw[4:8] + "-" + raw[8:12])
	}
	return out, nil
}
