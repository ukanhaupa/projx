package serviceconfig

import (
	"time"

	"gorm.io/gorm"

	"projx.local/go/internal/uuid"
)

type ServiceConfig struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	Purpose   string    `gorm:"uniqueIndex;type:varchar(64);not null" json:"purpose"`
	Config    string    `gorm:"type:text;not null" json:"-"`
	IsActive  bool      `gorm:"not null;default:true" json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ServiceConfig) TableName() string {
	return "service_configs"
}

func (s *ServiceConfig) BeforeCreate(_ *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.V4()
	}
	return nil
}
