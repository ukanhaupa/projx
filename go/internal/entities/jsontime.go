package entities

import (
	"database/sql/driver"
	"fmt"
	"strings"
	"time"
)

var jsonTimeLayouts = []string{
	time.RFC3339Nano,
	time.RFC3339,
	"2006-01-02T15:04:05",
	"2006-01-02",
}

type JSONTime struct{ time.Time }

func ParseTime(s string) (time.Time, error) {
	for _, layout := range jsonTimeLayouts {
		if parsed, err := time.Parse(layout, s); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("entities: cannot parse time %q", s)
}

func (t *JSONTime) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		t.Time = time.Time{}
		return nil
	}
	parsed, err := ParseTime(s)
	if err != nil {
		return err
	}
	t.Time = parsed
	return nil
}

func (t JSONTime) MarshalJSON() ([]byte, error) {
	if t.IsZero() {
		return []byte("null"), nil
	}
	return []byte(`"` + t.Format(time.RFC3339) + `"`), nil
}

func (t JSONTime) Value() (driver.Value, error) {
	if t.IsZero() {
		return nil, nil
	}
	return t.Time, nil
}

func (t *JSONTime) Scan(src any) error {
	switch s := src.(type) {
	case nil:
		t.Time = time.Time{}
	case time.Time:
		t.Time = s
	default:
		return fmt.Errorf("entities.JSONTime: cannot scan %T", src)
	}
	return nil
}

func (t *JSONTime) TimePtr() *time.Time {
	if t == nil || t.IsZero() {
		return nil
	}
	return &t.Time
}

func (JSONTime) GormDataType() string {
	return "time"
}
