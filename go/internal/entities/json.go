package entities

import (
	"database/sql/driver"
	"fmt"
)

type JSON []byte

func (j JSON) MarshalJSON() ([]byte, error) {
	if len(j) == 0 {
		return []byte("null"), nil
	}
	return j, nil
}

func (j *JSON) UnmarshalJSON(b []byte) error {
	if j == nil {
		return fmt.Errorf("entities.JSON: UnmarshalJSON on nil pointer")
	}
	*j = append((*j)[:0], b...)
	return nil
}

func (j JSON) Value() (driver.Value, error) {
	if len(j) == 0 {
		return nil, nil
	}
	return []byte(j), nil
}

func (j *JSON) Scan(src any) error {
	switch s := src.(type) {
	case nil:
		*j = nil
	case []byte:
		*j = append((*j)[:0], s...)
	case string:
		*j = append((*j)[:0], s...)
	default:
		return fmt.Errorf("entities.JSON: cannot scan %T", src)
	}
	return nil
}
