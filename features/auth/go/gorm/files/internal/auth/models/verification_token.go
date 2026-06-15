package authmodels

import (
	"time"

	"gorm.io/gorm"

	"projx.local/go/internal/uuid"
)

const (
	TokenKindPasswordReset = "password_reset"
	TokenKindEmailVerify   = "email_verify"
)

type VerificationToken struct {
	ID         string     `gorm:"primaryKey;type:uuid" json:"id"`
	UserID     string     `gorm:"type:uuid;index;not null" json:"user_id"`
	Kind       string     `gorm:"type:varchar(32);index;not null" json:"kind"`
	TokenHash  string     `gorm:"uniqueIndex;type:varchar(128);not null" json:"-"`
	ExpiresAt  time.Time  `gorm:"not null" json:"expires_at"`
	ConsumedAt *time.Time `json:"consumed_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func (VerificationToken) TableName() string { return "verification_tokens" }

func (v *VerificationToken) BeforeCreate(_ *gorm.DB) error {
	if v.ID == "" {
		v.ID = uuid.V4()
	}
	return nil
}
