package sync

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/entities"
	"projx.local/go/internal/httputil"
)

type FieldSchema struct {
	Name     string `json:"name"`
	JSONName string `json:"json_name"`
	DBName   string `json:"db_name"`
}

type EntitySchema struct {
	Name             string        `json:"name"`
	TableName        string        `json:"table_name"`
	BasePath         string        `json:"base_path"`
	APIPath          string        `json:"api_path"`
	SoftDelete       bool          `json:"soft_delete"`
	SearchableFields []string      `json:"searchable_fields"`
	HiddenFields     []string      `json:"hidden_fields"`
	Fields           []FieldSchema `json:"fields"`
}

type SchemasResponse struct {
	Entities map[string]EntitySchema `json:"entities"`
}

func Routes() chi.Router {
	r := chi.NewRouter()
	r.Method(http.MethodGet, "/schemas", apperr.H(func(w http.ResponseWriter, _ *http.Request) error {
		return httputil.WriteJSON(w, http.StatusOK, Build(entities.All()))
	}))
	return r
}

func Build(cfgs []entities.EntityConfig) SchemasResponse {
	out := SchemasResponse{Entities: map[string]EntitySchema{}}
	for _, cfg := range cfgs {
		hidden := map[string]struct{}{}
		for _, h := range cfg.HiddenFields {
			hidden[h] = struct{}{}
		}
		fields := make([]FieldSchema, 0, len(cfg.Columns))
		for _, col := range cfg.Columns {
			if _, h := hidden[col]; h {
				continue
			}
			fields = append(fields, FieldSchema{
				Name:     col,
				JSONName: col,
				DBName:   col,
			})
		}
		out.Entities[cfg.Name] = EntitySchema{
			Name:             cfg.Name,
			TableName:        cfg.TableName,
			BasePath:         cfg.BasePath,
			APIPath:          "/api/v1" + cfg.BasePath,
			SoftDelete:       cfg.SoftDelete,
			SearchableFields: append([]string{}, cfg.SearchableFields...),
			HiddenFields:     append([]string{}, cfg.HiddenFields...),
			Fields:           fields,
		}
	}
	return out
}
