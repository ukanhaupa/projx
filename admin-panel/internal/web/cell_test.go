package web

import (
	"math/big"
	"net"
	"net/netip"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestCellNil(t *testing.T) {
	if got := cell(nil); got != "" {
		t.Fatalf("nil → %q, want empty string", got)
	}
}

func TestCellString(t *testing.T) {
	if got := cell("hello"); got != "hello" {
		t.Fatalf("string → %q", got)
	}
}

func TestCellUUID(t *testing.T) {
	id := [16]byte{0x46, 0x11, 0x34, 0x7e, 0x32, 0x0f, 0x4d, 0x27, 0x86, 0x21, 0xdd, 0xba, 0xdb, 0xff, 0x00, 0x11}
	got := cell(id)
	want := "4611347e-320f-4d27-8621-ddbadbff0011"
	if got != want {
		t.Fatalf("uuid → %q, want %q", got, want)
	}
}

func TestCellBytea(t *testing.T) {
	got := cell([]byte{0xde, 0xad, 0xbe, 0xef})
	if got != `\xdeadbeef` {
		t.Fatalf("bytea → %q, want \\xdeadbeef", got)
	}
}

func TestCellBytea_Empty(t *testing.T) {
	if got := cell([]byte{}); got != `\x` {
		t.Fatalf("empty bytea → %q", got)
	}
}

func TestCellBool(t *testing.T) {
	if cell(true) != "true" || cell(false) != "false" {
		t.Fatal("bool not formatted as true/false")
	}
}

func TestCellInts(t *testing.T) {
	tests := []struct {
		in   any
		want string
	}{
		{int16(-32768), "-32768"},
		{int32(42), "42"},
		{int64(9223372036854775807), "9223372036854775807"},
		{int(7), "7"},
		{uint32(4294967295), "4294967295"},
	}
	for _, tt := range tests {
		if got := cell(tt.in); got != tt.want {
			t.Errorf("%T(%v) → %q, want %q", tt.in, tt.in, got, tt.want)
		}
	}
}

func TestCellFloats(t *testing.T) {
	if got := cell(float64(3.14159265358979)); got != "3.14159265358979" {
		t.Fatalf("float64 → %q", got)
	}
	if got := cell(float32(2.5)); got != "2.5" {
		t.Fatalf("float32 → %q", got)
	}
}

func TestCellTime(t *testing.T) {
	ts := time.Date(2026, 6, 8, 10, 30, 45, 123456789, time.UTC)
	got := cell(ts)
	want := "2026-06-08T10:30:45.123456789Z"
	if got != want {
		t.Fatalf("time → %q, want %q", got, want)
	}
}

func TestCellPgDate(t *testing.T) {
	d := pgtype.Date{Time: time.Date(2026, 6, 8, 0, 0, 0, 0, time.UTC), Valid: true}
	if got := cell(d); got != "2026-06-08" {
		t.Fatalf("pgtype.Date → %q", got)
	}
	if got := cell(pgtype.Date{}); got != "" {
		t.Fatalf("invalid pgtype.Date → %q", got)
	}
}

func TestCellPgTime(t *testing.T) {
	tm := pgtype.Time{Microseconds: int64(10*time.Hour+30*time.Minute+45*time.Second) / int64(time.Microsecond), Valid: true}
	got := cell(tm)
	if got != "10:30:45" {
		t.Fatalf("pgtype.Time → %q, want 10:30:45", got)
	}
}

func TestCellNumeric(t *testing.T) {
	n := pgtype.Numeric{Int: bigInt("12345"), Exp: -2, Valid: true}
	got := cell(n)
	if got == "" {
		t.Fatalf("pgtype.Numeric → empty (want '123.45' or similar)")
	}
}

func TestCellInterval(t *testing.T) {
	iv := pgtype.Interval{Days: 3, Microseconds: int64(2 * time.Hour / time.Microsecond), Valid: true}
	got := cell(iv)
	if got == "" || got == "0" {
		t.Fatalf("interval → %q (expected days + hours)", got)
	}
}

func TestCellInetPrefix(t *testing.T) {
	p, _ := netip.ParsePrefix("10.0.0.1/24")
	if got := cell(p); got != "10.0.0.1/24" {
		t.Fatalf("netip.Prefix → %q", got)
	}
}

func TestCellInetAddr(t *testing.T) {
	a := netip.MustParseAddr("2001:db8::1")
	if got := cell(a); got != "2001:db8::1" {
		t.Fatalf("netip.Addr → %q", got)
	}
}

func TestCellMacAddr(t *testing.T) {
	mac, _ := net.ParseMAC("aa:bb:cc:dd:ee:ff")
	if got := cell(mac); got != "aa:bb:cc:dd:ee:ff" {
		t.Fatalf("MAC → %q", got)
	}
}

func TestCellJSONObject(t *testing.T) {
	v := map[string]any{"name": "alpha", "count": 3}
	got := cell(v)
	if got != `{"count":3,"name":"alpha"}` {
		t.Fatalf("jsonb object → %q", got)
	}
}

func TestCellJSONArray(t *testing.T) {
	v := []any{1, "two", true}
	got := cell(v)
	if got != `[1,"two",true]` {
		t.Fatalf("jsonb array → %q", got)
	}
}

func TestCellStringerFallback(t *testing.T) {
	got := cell(stringerThing("hi"))
	if got != "stringer:hi" {
		t.Fatalf("Stringer → %q", got)
	}
}

type stringerThing string

func (s stringerThing) String() string { return "stringer:" + string(s) }

func bigInt(s string) *big.Int {
	out := new(big.Int)
	out.SetString(s, 10)
	return out
}
