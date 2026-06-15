package authmodels

import (
	"time"

	"gorm.io/gorm"

	"projx.local/go/internal/uuid"
)

type RefreshToken struct {
	ID               string     `gorm:"primaryKey;type:uuid" json:"id"`
	UserID           string     `gorm:"type:uuid;index;not null" json:"user_id"`
	SessionID        string     `gorm:"type:uuid;index;not null" json:"session_id"`
	TokenHash        string     `gorm:"uniqueIndex;type:varchar(128);not null" json:"-"`
	IPAddress        string     `gorm:"type:varchar(64)" json:"ip_address"`
	UserAgent        string     `gorm:"type:text" json:"user_agent"`
	ExpiresAt        time.Time  `gorm:"not null" json:"expires_at"`
	RevokedAt        *time.Time `json:"revoked_at,omitempty"`
	RotatedTo        *string    `gorm:"type:uuid" json:"-"`
	ReplayDetectedAt *time.Time `json:"-"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

func (RefreshToken) TableName() string { return "refresh_tokens" }

func (r *RefreshToken) BeforeCreate(_ *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.V4()
	}
	return nil
}
