package entities

import (
	"context"
	"net/http"
)

type ListParams struct {
	Limit          int
	Offset         int
	Search         string
	OrderBy        []OrderClause
	Filters        map[string]string
	IncludeDeleted bool
}

type OrderClause struct {
	Column string
	Desc   bool
}

type Page struct {
	Items []any
	Total int64
}

type Querier interface {
	List(ctx context.Context, p ListParams) (Page, error)
	Get(ctx context.Context, id string) (any, error)
	Create(ctx context.Context, payload []byte) (any, error)
	Update(ctx context.Context, id string, patch map[string]any) (any, error)
	Delete(ctx context.Context, id string) error
	BulkCreate(ctx context.Context, payloads [][]byte) ([]any, error)
	BulkDelete(ctx context.Context, ids []string) error
}

type Hooks struct {
	BeforeCreate       func(r *http.Request, payload []byte) ([]byte, error)
	AfterCreate        func(r *http.Request, record any)
	BeforeUpdate       func(r *http.Request, w http.ResponseWriter, patch map[string]any) (handled bool, err error)
	AfterUpdate        func(r *http.Request, before, after any)
	BeforeDelete       func(r *http.Request, id string) error
	BeforeCreateFields []string
}

type EntityConfig struct {
	Name             string
	BasePath         string
	TableName        string
	Columns          []string
	UpdatableColumns []string
	SearchableFields []string
	HiddenFields     []string
	SoftDelete       bool
	Hooks            Hooks
	Querier          Querier
}
