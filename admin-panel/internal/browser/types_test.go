package browser

import "testing"

func col(udt string, nullable bool) *Column {
	return &Column{Name: "c", UDTName: udt, Nullable: nullable}
}

func TestInputKind(t *testing.T) {
	cases := map[string]InputKind{
		"bool":        InputCheckbox,
		"int4":        InputNumber,
		"int8":        InputNumber,
		"numeric":     InputNumber,
		"jsonb":       InputTextarea,
		"json":        InputTextarea,
		"timestamptz": InputDatetime,
		"date":        InputDatetime,
		"text":        InputText,
		"uuid":        InputText,
		"_text":       InputTextarea,
	}
	for udt, want := range cases {
		if got := col(udt, false).Input(); got != want {
			t.Errorf("udt %q: want %q, got %q", udt, want, got)
		}
	}
}

func TestCoerceBool(t *testing.T) {
	for _, truthy := range []string{"true", "t", "1", "on", "yes", "TRUE"} {
		v, err := coerce(col("bool", false), truthy)
		if err != nil || v != true {
			t.Errorf("%q should coerce to true (got %v, %v)", truthy, v, err)
		}
	}
	for _, falsy := range []string{"false", "f", "0", "off", "no", ""} {
		v, err := coerce(col("bool", false), falsy)
		if err != nil || v != false {
			t.Errorf("%q should coerce to false (got %v, %v)", falsy, v, err)
		}
	}
}

func TestCoerceInt(t *testing.T) {
	v, err := coerce(col("int4", false), "42")
	if err != nil || v.(int64) != 42 {
		t.Fatalf("want 42, got %v (%v)", v, err)
	}
	if _, err := coerce(col("int4", false), "not-a-number"); err == nil {
		t.Fatal("expected error for non-integer")
	}
}

func TestCoerceNumeric(t *testing.T) {
	v, err := coerce(col("numeric", false), "3.14")
	if err != nil || v.(float64) != 3.14 {
		t.Fatalf("want 3.14, got %v (%v)", v, err)
	}
	if _, err := coerce(col("float8", false), "abc"); err == nil {
		t.Fatal("expected error for non-number")
	}
}

func TestCoerceJSON(t *testing.T) {
	v, err := coerce(col("jsonb", false), `{"a":1}`)
	if err != nil || v != `{"a":1}` {
		t.Fatalf("valid json should pass through, got %v (%v)", v, err)
	}
	if _, err := coerce(col("jsonb", false), `{not json}`); err == nil {
		t.Fatal("expected error for invalid json")
	}
}

func TestCoerceNullableEmpty(t *testing.T) {
	v, err := coerce(col("text", true), "")
	if err != nil || v != nil {
		t.Fatalf("empty nullable should be nil, got %v (%v)", v, err)
	}
	v, err = coerce(col("text", false), "")
	if err != nil || v != "" {
		t.Fatalf("empty non-nullable text should be empty string, got %v (%v)", v, err)
	}
}
