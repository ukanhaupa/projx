package browser

import "testing"

func TestPermsReadOnlyByDefault(t *testing.T) {
	p := NewPerms(nil)
	if p.CanWrite("users") {
		t.Fatal("expected tables to be read-only by default")
	}
}

func TestPermsWriteAllowlist(t *testing.T) {
	p := NewPerms([]string{"users", "posts"})
	if !p.CanWrite("users") {
		t.Fatal("expected users to be writable")
	}
	if !p.CanWrite("posts") {
		t.Fatal("expected posts to be writable")
	}
	if p.CanWrite("payments") {
		t.Fatal("expected payments to remain read-only")
	}
}
