package browser

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type InputKind string

const (
	InputText     InputKind = "text"
	InputNumber   InputKind = "number"
	InputCheckbox InputKind = "checkbox"
	InputTextarea InputKind = "textarea"
	InputDatetime InputKind = "datetime-local"
)

func (c *Column) Input() InputKind {
	switch c.UDTName {
	case "bool":
		return InputCheckbox
	case "int2", "int4", "int8", "float4", "float8", "numeric":
		return InputNumber
	case "json", "jsonb":
		return InputTextarea
	case "timestamp", "timestamptz", "date":
		return InputDatetime
	default:
		if strings.HasPrefix(c.UDTName, "_") {
			return InputTextarea
		}
		return InputText
	}
}

func coerce(c *Column, raw string) (any, error) {
	trimmed := strings.TrimSpace(raw)

	if trimmed == "" {
		if c.Nullable {
			return nil, nil
		}
		if c.UDTName == "bool" {
			return false, nil
		}
		return "", nil
	}

	switch c.UDTName {
	case "bool":
		return parseBool(trimmed), nil
	case "int2", "int4", "int8":
		n, err := strconv.ParseInt(trimmed, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("column %q expects an integer", c.Name)
		}
		return n, nil
	case "float4", "float8", "numeric":
		f, err := strconv.ParseFloat(trimmed, 64)
		if err != nil {
			return nil, fmt.Errorf("column %q expects a number", c.Name)
		}
		return f, nil
	case "json", "jsonb":
		if !json.Valid([]byte(trimmed)) {
			return nil, fmt.Errorf("column %q expects valid JSON", c.Name)
		}
		return trimmed, nil
	default:
		return raw, nil
	}
}

func parseBool(v string) bool {
	switch strings.ToLower(v) {
	case "true", "t", "1", "on", "yes":
		return true
	default:
		return false
	}
}
