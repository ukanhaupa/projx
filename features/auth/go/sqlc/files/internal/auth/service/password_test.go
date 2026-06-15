package authservice

import (
	"strings"
	"testing"
)

func TestHashPasswordRoundtrip(t *testing.T) {
	hash, err := HashPassword("Sup3rSecret!")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Fatalf("expected argon2id encoded, got %q", hash)
	}
	if !VerifyPassword("Sup3rSecret!", hash) {
		t.Fatal("password should verify")
	}
	if VerifyPassword("wrong", hash) {
		t.Fatal("wrong password should fail")
	}
}

func TestHashTokenStable(t *testing.T) {
	a := HashToken("abc")
	b := HashToken("abc")
	if a != b {
		t.Fatal("hash must be deterministic")
	}
	if HashToken("abd") == a {
		t.Fatal("hash must differ for different inputs")
	}
}

func TestRandomTokenNonEmpty(t *testing.T) {
	tok, err := RandomToken(16)
	if err != nil {
		t.Fatal(err)
	}
	if len(tok) == 0 {
		t.Fatal("expected non-empty token")
	}
}
