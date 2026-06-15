package entities

import (
	"encoding/json"
	"testing"
	"time"
)

func TestJSONTimeUnmarshalLayouts(t *testing.T) {
	for _, in := range []string{
		`"2026-01-01"`,
		`"2026-01-01T00:00:00"`,
		`"2026-01-01T00:00:00Z"`,
		`"2026-01-01T00:00:00.500Z"`,
	} {
		var jt JSONTime
		if err := json.Unmarshal([]byte(in), &jt); err != nil {
			t.Fatalf("unmarshal %s: %v", in, err)
		}
		if jt.Year() != 2026 {
			t.Fatalf("unmarshal %s gave %v", in, jt.Time)
		}
	}
}

func TestJSONTimeUnmarshalNullAndInvalid(t *testing.T) {
	var jt JSONTime
	if err := json.Unmarshal([]byte(`null`), &jt); err != nil || !jt.IsZero() {
		t.Fatalf("null should zero: %v %v", err, jt.Time)
	}
	if err := json.Unmarshal([]byte(`"not-a-date"`), &jt); err == nil {
		t.Fatal("invalid date should error")
	}
}

func TestJSONTimeMarshal(t *testing.T) {
	out, _ := JSONTime{}.MarshalJSON()
	if string(out) != "null" {
		t.Fatalf("zero should marshal null, got %s", out)
	}
	jt := JSONTime{time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	out, _ = jt.MarshalJSON()
	if string(out) != `"2026-01-01T00:00:00Z"` {
		t.Fatalf("marshal wrong: %s", out)
	}
}

func TestJSONTimeValue(t *testing.T) {
	v, _ := JSONTime{}.Value()
	if v != nil {
		t.Fatalf("zero Value should be nil, got %v", v)
	}
	v, _ = JSONTime{time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}.Value()
	if _, ok := v.(time.Time); !ok {
		t.Fatalf("non-zero Value should be time.Time, got %T", v)
	}
}

func TestJSONTimeScan(t *testing.T) {
	var jt JSONTime
	if err := jt.Scan(nil); err != nil || !jt.IsZero() {
		t.Fatalf("scan nil: %v", err)
	}
	now := time.Now()
	if err := jt.Scan(now); err != nil || !jt.Equal(now) {
		t.Fatalf("scan time: %v", err)
	}
	if err := jt.Scan("nope"); err == nil {
		t.Fatal("scan string should error")
	}
}

func TestJSONTimeTimePtr(t *testing.T) {
	var nilPtr *JSONTime
	if nilPtr.TimePtr() != nil {
		t.Fatal("nil receiver should give nil")
	}
	if (&JSONTime{}).TimePtr() != nil {
		t.Fatal("zero should give nil")
	}
	jt := &JSONTime{time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	if jt.TimePtr() == nil {
		t.Fatal("non-zero should give ptr")
	}
}

func TestJSONTimeGormDataType(t *testing.T) {
	if (JSONTime{}).GormDataType() != "time" {
		t.Fatal("GormDataType should be time")
	}
}

func TestParseTime(t *testing.T) {
	if _, err := ParseTime("2026-01-01"); err != nil {
		t.Fatalf("bare date should parse: %v", err)
	}
	if _, err := ParseTime("2026-01-01T00:00:00Z"); err != nil {
		t.Fatalf("rfc3339 should parse: %v", err)
	}
	if _, err := ParseTime("nope"); err == nil {
		t.Fatal("invalid should error")
	}
}
