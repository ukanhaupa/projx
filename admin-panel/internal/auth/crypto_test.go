package auth

import "testing"

func TestEncryptDecryptRoundTrip(t *testing.T) {
	secret := "session-secret-for-crypto-tests-0123456789"
	plain := "JBSWY3DPEHPK3PXP"
	enc, err := encryptSecret(plain, secret)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if enc == plain {
		t.Fatal("ciphertext must differ from plaintext")
	}
	got, err := decryptSecret(enc, secret)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got != plain {
		t.Fatalf("round-trip mismatch: got %q want %q", got, plain)
	}
}

func TestDecryptRejectsWrongKey(t *testing.T) {
	enc, err := encryptSecret("topsecret", "key-one-0123456789012345678901234567")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if _, err := decryptSecret(enc, "key-two-0123456789012345678901234567"); err == nil {
		t.Fatal("decrypt with a different key must fail")
	}
}

func TestDecryptRejectsGarbage(t *testing.T) {
	if _, err := decryptSecret("!!!not-base64!!!", "k"); err == nil {
		t.Fatal("decrypt must reject non-base64 input")
	}
	if _, err := decryptSecret("AAAA", "key-0123456789012345678901234567890"); err == nil {
		t.Fatal("decrypt must reject a too-short ciphertext")
	}
}

func TestOTPAuthURLShape(t *testing.T) {
	u := OTPAuthURL("JBSWY3DPEHPK3PXP", "admin@example.com")
	for _, want := range []string{"otpauth://totp/", "secret=JBSWY3DPEHPK3PXP", "issuer="} {
		if !contains(u, want) {
			t.Errorf("otpauth url %q missing %q", u, want)
		}
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
