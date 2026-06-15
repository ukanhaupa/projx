package sync

import (
	"net/http"
	"reflect"
	"strings"
	gosync "sync"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/entities"
	"projx.local/go/internal/httputil"
)

type FieldSchema struct {
	Name       string `json:"name"`
	JSONName   string `json:"json_name"`
	DBName     string `json:"db_name"`
	Type       string `json:"type"`
	Nullable   bool   `json:"nullable"`
	PrimaryKey bool   `json:"primary_key,omitempty"`
	Unique     bool   `json:"unique,omitempty"`
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

func Routes(gdb *gorm.DB) chi.Router {
	r := chi.NewRouter()
	r.Method(http.MethodGet, "/schemas", apperr.H(func(w http.ResponseWriter, _ *http.Request) error {
		body, err := Build(gdb, entities.All())
		if err != nil {
			return err
		}
		return httputil.WriteJSON(w, http.StatusOK, body)
	}))
	return r
}

func Build(gdb *gorm.DB, cfgs []entities.EntityConfig) (SchemasResponse, error) {
	out := SchemasResponse{Entities: map[string]EntitySchema{}}
	for _, cfg := range cfgs {
		es, err := buildEntity(gdb, cfg)
		if err != nil {
			return SchemasResponse{}, err
		}
		out.Entities[cfg.Name] = es
	}
	return out, nil
}

func buildEntity(gdb *gorm.DB, cfg entities.EntityConfig) (EntitySchema, error) {
	s, err := schema.Parse(cfg.Model, &gosync.Map{}, gdb.NamingStrategy)
	if err != nil {
		return EntitySchema{}, err
	}
	hidden := map[string]struct{}{}
	for _, h := range cfg.HiddenFields {
		hidden[h] = struct{}{}
		if f := s.LookUpField(h); f != nil && f.DBName != "" {
			hidden[f.DBName] = struct{}{}
		}
	}
	fields := make([]FieldSchema, 0, len(s.Fields))
	for _, f := range s.Fields {
		if f.DBName == "" {
			continue
		}
		if _, h := hidden[f.Name]; h {
			continue
		}
		if _, h := hidden[f.DBName]; h {
			continue
		}
		fields = append(fields, FieldSchema{
			Name:       f.Name,
			JSONName:   jsonNameFor(cfg.Model, f.Name, f.DBName),
			DBName:     f.DBName,
			Type:       typeName(f.FieldType),
			Nullable:   !f.NotNull,
			PrimaryKey: f.PrimaryKey,
			Unique:     f.Unique,
		})
	}
	return EntitySchema{
		Name:             cfg.Name,
		TableName:        s.Table,
		BasePath:         cfg.BasePath,
		APIPath:          "/api/v1" + cfg.BasePath,
		SoftDelete:       cfg.SoftDelete,
		SearchableFields: append([]string{}, cfg.SearchableFields...),
		HiddenFields:     append([]string{}, cfg.HiddenFields...),
		Fields:           fields,
	}, nil
}

func jsonNameFor(model any, fieldName, fallback string) string {
	t := reflect.TypeOf(model)
	if t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct {
		return fallback
	}
	sf, ok := t.FieldByName(fieldName)
	if !ok {
		return fallback
	}
	tag := sf.Tag.Get("json")
	if tag == "" || tag == "-" {
		return fallback
	}
	if i := strings.IndexByte(tag, ','); i >= 0 {
		tag = tag[:i]
	}
	if tag == "" || tag == "-" {
		return fallback
	}
	return tag
}

func typeName(t reflect.Type) string {
	if t == nil {
		return ""
	}
	if t.Kind() == reflect.Pointer {
		return typeName(t.Elem())
	}
	if t.PkgPath() == "" {
		return t.Kind().String()
	}
	return t.PkgPath() + "." + t.Name()
}
