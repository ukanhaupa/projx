package posts

import (
	"time"

	"gorm.io/gorm"

	"projx.local/go/internal/entities"
	"projx.local/go/internal/uuid"
)

type Post struct {
	ID        string         `gorm:"primaryKey;type:uuid" json:"id"`
	Title     string         `gorm:"not null" json:"title" validate:"required,max=200"`
	Body      string         `json:"body"`
	Published bool           `json:"published"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (p *Post) BeforeCreate(_ *gorm.DB) error {
	if p.ID == "" {
		p.ID = uuid.V4()
	}
	return nil
}

func Config() entities.EntityConfig {
	return entities.EntityConfig{
		Name:             "post",
		Model:            &Post{},
		BasePath:         "/posts",
		SearchableFields: []string{"title", "body"},
		SoftDelete:       true,
	}
}
