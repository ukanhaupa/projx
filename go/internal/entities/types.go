package entities

import (
	"net/http"

	"gorm.io/gorm/schema"
)

type Hooks struct {
	BeforeCreate       func(r *http.Request, data any) error
	AfterCreate        func(r *http.Request, record any)
	BeforeUpdate       func(r *http.Request, w http.ResponseWriter, data any) (handled bool, err error)
	AfterUpdate        func(r *http.Request, before, after any)
	BeforeDelete       func(r *http.Request, id string) error
	BeforeCreateFields []string
}

type EntityConfig struct {
	Name             string
	Model            any
	BasePath         string
	SearchableFields []string
	HiddenFields     []string
	SoftDelete       bool
	Hooks            Hooks

	schema           *schema.Schema
	immutableColumns map[string]struct{}
}
