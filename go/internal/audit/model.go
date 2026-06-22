package audit

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"

	"projx.local/go/internal/uuid"
)

type Action string

const (
	ActionInsert Action = "INSERT"
	ActionUpdate Action = "UPDATE"
	ActionDelete Action = "DELETE"
)

type JSON map[string]any

func (j JSON) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	return json.Marshal(j)
}

func (j *JSON) Scan(src any) error {
	if src == nil {
		*j = nil
		return nil
	}
	var b []byte
	switch v := src.(type) {
	case []byte:
		b = v
	case string:
		b = []byte(v)
	default:
		return errors.New("audit.JSON: unsupported Scan source")
	}
	return json.Unmarshal(b, j)
}

type AuditLog struct {
	ID          string    `gorm:"primaryKey;type:uuid" json:"id"`
	TargetTable string    `gorm:"column:table_name;type:varchar(255);not null;index" json:"table_name"`
	RecordID    string    `gorm:"column:record_id;type:varchar(255);not null;index" json:"record_id"`
	Action      Action    `gorm:"type:varchar(64);not null" json:"action"`
	OldValue    JSON      `gorm:"type:jsonb" json:"old_value"`
	NewValue    JSON      `gorm:"type:jsonb" json:"new_value"`
	PerformedBy string    `gorm:"type:varchar(255);not null;default:system" json:"performed_by"`
	PerformedAt time.Time `gorm:"not null;default:now()" json:"performed_at"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (AuditLog) TableName() string {
	return "audit_logs"
}

func (a *AuditLog) BeforeCreate(_ *gorm.DB) error {
	if a.ID == "" {
		a.ID = uuid.V4()
	}
	if a.PerformedBy == "" {
		a.PerformedBy = SystemActor
	}
	return nil
}
