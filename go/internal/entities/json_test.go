package entities

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestJSONMarshalEmptyIsNull(t *testing.T) {
	out, err := json.Marshal(JSON(nil))
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != "null" {
		t.Fatalf("empty JSON should marshal to null, got %s", out)
	}
}

func TestJSONMarshalRaw(t *testing.T) {
	out, err := json.Marshal(JSON(`{"k":"v"}`))
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != `{"k":"v"}` {
		t.Fatalf("raw JSON not preserved: %s", out)
	}
}

func TestJSONUnmarshalCapturesRaw(t *testing.T) {
	var j JSON
	if err := json.Unmarshal([]byte(`{"a":1}`), &j); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(j, []byte(`{"a":1}`)) {
		t.Fatalf("unmarshal did not capture raw: %s", j)
	}
}

func TestJSONUnmarshalNilPointer(t *testing.T) {
	var j *JSON
	if err := j.UnmarshalJSON([]byte(`{}`)); err == nil {
		t.Fatal("expected error on nil pointer")
	}
}

func TestJSONValue(t *testing.T) {
	v, err := JSON(nil).Value()
	if err != nil || v != nil {
		t.Fatalf("empty JSON Value should be nil, got %v", v)
	}
	v, err = JSON(`{"k":"v"}`).Value()
	if err != nil {
		t.Fatal(err)
	}
	if b, ok := v.([]byte); !ok || string(b) != `{"k":"v"}` {
		t.Fatalf("non-empty JSON Value wrong: %v", v)
	}
}

func TestJSONScan(t *testing.T) {
	var j JSON
	if err := j.Scan(nil); err != nil || j != nil {
		t.Fatalf("scan nil: %v %v", err, j)
	}
	if err := j.Scan([]byte(`{"b":2}`)); err != nil || !bytes.Equal(j, []byte(`{"b":2}`)) {
		t.Fatalf("scan bytes: %v %s", err, j)
	}
	if err := j.Scan(`{"c":3}`); err != nil || !bytes.Equal(j, []byte(`{"c":3}`)) {
		t.Fatalf("scan string: %v %s", err, j)
	}
	if err := j.Scan(42); err == nil {
		t.Fatal("scan int should error")
	}
}
