package authmodels

import (
	"time"

	"gorm.io/gorm"

	"projx.local/go/internal/uuid"
)

type User struct {
	ID                  string         `gorm:"primaryKey;type:uuid" json:"id"`
	Email               string         `gorm:"uniqueIndex;type:varchar(255);not null" json:"email"`
	Name                string         `gorm:"type:varchar(255);not null" json:"name"`
	PasswordHash        string         `gorm:"type:varchar(255)" json:"-"`
	Role                string         `gorm:"type:varchar(32);not null;default:user" json:"role"`
	EmailVerified       bool           `gorm:"not null;default:false" json:"email_verified"`
	EmailVerifiedAt     *time.Time     `json:"email_verified_at,omitempty"`
	FailedLoginCount    int            `gorm:"not null;default:0" json:"-"`
	LockedUntil         *time.Time     `json:"-"`
	MFAEnabled          bool           `gorm:"column:mfa_enabled;not null;default:false" json:"mfa_enabled"`
	MFASecretEnc        string         `gorm:"column:mfa_secret_enc;type:text" json:"-"`
	MFARecoveryCodesEnc string         `gorm:"column:mfa_recovery_codes_enc;type:text" json:"-"`
	MFAVerifiedAt       *time.Time     `gorm:"column:mfa_verified_at" json:"-"`
	MFAFailedCount      int            `gorm:"column:mfa_failed_count;not null;default:0" json:"-"`
	MFALockedUntil      *time.Time     `gorm:"column:mfa_locked_until" json:"-"`
	LastLogin           *time.Time     `json:"last_login,omitempty"`
	CreatedAt           time.Time      `json:"created_at"`
	UpdatedAt           time.Time      `json:"updated_at"`
	DeletedAt           gorm.DeletedAt `gorm:"index" json:"-"`
}

func (User) TableName() string { return "users" }

func (u *User) BeforeCreate(_ *gorm.DB) error {
	if u.ID == "" {
		u.ID = uuid.V4()
	}
	return nil
}
