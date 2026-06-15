package entities

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"reflect"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/httputil"
	"projx.local/go/internal/requestid"
)

var validate = validator.New(validator.WithRequiredStructEnabled())

func formatValidationError(err error, model any) string {
	vErrs, ok := err.(validator.ValidationErrors)
	if !ok {
		return "validation failed"
	}
	t := reflect.TypeOf(model)
	if t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	msgs := make([]string, 0, len(vErrs))
	for _, fe := range vErrs {
		name := fe.Field()
		if t.Kind() == reflect.Struct {
			if sf, ok := t.FieldByName(fe.StructField()); ok {
				if tag := jsonTagName(sf); tag != "" && tag != "-" {
					name = tag
				}
			}
		}
		msgs = append(msgs, fieldRuleMessage(name, fe))
	}
	return strings.Join(msgs, ", ")
}

func fieldRuleMessage(name string, fe validator.FieldError) string {
	switch fe.Tag() {
	case "required":
		return "field '" + name + "' is required"
	case "max":
		return "field '" + name + "' must be at most " + fe.Param() + " chars"
	case "min":
		return "field '" + name + "' must be at least " + fe.Param() + " chars"
	case "email":
		return "field '" + name + "' must be a valid email"
	case "oneof":
		return "field '" + name + "' must be one of: " + fe.Param()
	default:
		return "field '" + name + "' is invalid"
	}
}

func MountEntity(r chi.Router, gdb *gorm.DB, cfg EntityConfig) {
	if cfg.schema == nil {
		s, err := schema.Parse(cfg.Model, &sync.Map{}, gdb.NamingStrategy)
		if err != nil {
			panic("entities.MountEntity(" + cfg.Name + "): parse schema: " + err.Error())
		}
		cfg.schema = s
		cfg.immutableColumns = immutableColumnSet(s)
	}
	r.Route(cfg.BasePath, func(sub chi.Router) {
		sub.Method(http.MethodGet, "/", apperr.H(listHandler(gdb, cfg)))
		sub.Method(http.MethodPost, "/", apperr.H(createHandler(gdb, cfg)))
		sub.Method(http.MethodPost, "/bulk", apperr.H(bulkCreateHandler(gdb, cfg)))
		sub.Method(http.MethodDelete, "/bulk", apperr.H(bulkDeleteHandler(gdb, cfg)))
		sub.Method(http.MethodGet, "/{id}", apperr.H(getHandler(gdb, cfg)))
		sub.Method(http.MethodPatch, "/{id}", apperr.H(updateHandler(gdb, cfg)))
		sub.Method(http.MethodDelete, "/{id}", apperr.H(deleteHandler(gdb, cfg)))
	})
}

func listHandler(gdb *gorm.DB, cfg EntityConfig) apperr.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		q := scope(gdb, r, cfg)
		q, opts := ApplyFilters(q, r.URL.Query(), cfg)

		slice := reflect.New(reflect.SliceOf(structTypeOf(cfg.Model))).Interface()
		page, err := Paginate(q, opts, slice)
		if err != nil {
			return apperr.FromDB(err, cfg.Name)
		}
		stripHiddenSlice(slice, cfg.HiddenFields)
		return httputil.WriteJSON(w, http.StatusOK, PageResult{Data: slice, Pagination: page})
	}
}

func getHandler(gdb *gorm.DB, cfg EntityConfig) apperr.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := chi.URLParam(r, "id")
		record := reflect.New(structTypeOf(cfg.Model)).Interface()
		if err := scope(gdb, r, cfg).First(record, "id = ?", id).Error; err != nil {
			return apperr.FromDB(err, cfg.Name)
		}
		stripHidden(record, cfg.HiddenFields)
		return httputil.WriteJSON(w, http.StatusOK, record)
	}
}

func createHandler(gdb *gorm.DB, cfg EntityConfig) apperr.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		record := reflect.New(structTypeOf(cfg.Model)).Interface()
		if err := json.NewDecoder(r.Body).Decode(record); err != nil {
			return apperr.Validation("invalid JSON body")
		}
		if cfg.Hooks.BeforeCreate != nil {
			if err := cfg.Hooks.BeforeCreate(r, record); err != nil {
				return err
			}
		}
		if err := validate.Struct(record); err != nil {
			return apperr.Validation(formatValidationError(err, cfg.Model))
		}
		if err := gdb.Create(record).Error; err != nil {
			return apperr.FromDB(err, cfg.Name)
		}
		if cfg.Hooks.AfterCreate != nil {
			runBestEffort(r, cfg.Name, "after_create", func() { cfg.Hooks.AfterCreate(r, record) })
		}
		stripHidden(record, cfg.HiddenFields)
		return httputil.WriteJSON(w, http.StatusCreated, record)
	}
}

func updateHandler(gdb *gorm.DB, cfg EntityConfig) apperr.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := chi.URLParam(r, "id")
		before := reflect.New(structTypeOf(cfg.Model)).Interface()
		if err := scope(gdb, r, cfg).First(before, "id = ?", id).Error; err != nil {
			return apperr.FromDB(err, cfg.Name)
		}

		rawBody, err := io.ReadAll(r.Body)
		if err != nil {
			return apperr.Validation("failed to read body")
		}
		var rawMap map[string]json.RawMessage
		if err := json.Unmarshal(rawBody, &rawMap); err != nil {
			return apperr.Validation("invalid JSON body")
		}

		decoded := reflect.New(structTypeOf(cfg.Model)).Interface()
		if err := json.Unmarshal(rawBody, decoded); err != nil {
			return apperr.Validation("invalid JSON body")
		}
		if err := validate.Struct(decoded); err != nil {
			if !isPartialValidationError(err, rawMap) {
				return apperr.Validation(formatValidationError(err, cfg.Model))
			}
		}

		patch := buildAllowedPatch(cfg, decoded, rawMap)

		if cfg.Hooks.BeforeUpdate != nil {
			handled, err := cfg.Hooks.BeforeUpdate(r, w, patch)
			if err != nil {
				return err
			}
			if handled {
				return nil
			}
		}

		after := reflect.New(structTypeOf(cfg.Model)).Interface()
		if len(patch) > 0 {
			if err := gdb.Model(after).Where("id = ?", id).Updates(patch).Error; err != nil {
				return apperr.FromDB(err, cfg.Name)
			}
		}
		if err := scope(gdb, r, cfg).First(after, "id = ?", id).Error; err != nil {
			return apperr.FromDB(err, cfg.Name)
		}
		if cfg.Hooks.AfterUpdate != nil {
			runBestEffort(r, cfg.Name, "after_update", func() { cfg.Hooks.AfterUpdate(r, before, after) })
		}
		stripHidden(after, cfg.HiddenFields)
		return httputil.WriteJSON(w, http.StatusOK, after)
	}
}

func deleteHandler(gdb *gorm.DB, cfg EntityConfig) apperr.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := chi.URLParam(r, "id")
		if cfg.Hooks.BeforeDelete != nil {
			if err := cfg.Hooks.BeforeDelete(r, id); err != nil {
				return err
			}
		}
		record := reflect.New(structTypeOf(cfg.Model)).Interface()
		res := gdb.WithContext(r.Context()).Where("id = ?", id).Delete(record)
		if res.Error != nil {
			return apperr.FromDB(res.Error, cfg.Name)
		}
		if res.RowsAffected == 0 {
			return apperr.NotFound(cfg.Name)
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func bulkCreateHandler(gdb *gorm.DB, cfg EntityConfig) apperr.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		sliceType := reflect.SliceOf(structTypeOf(cfg.Model))
		slicePtr := reflect.New(sliceType)
		if err := json.NewDecoder(r.Body).Decode(slicePtr.Interface()); err != nil {
			return apperr.Validation("invalid JSON body")
		}
		slice := slicePtr.Elem()
		if slice.Len() == 0 {
			return apperr.Validation("body must be a non-empty array")
		}
		txErr := gdb.Transaction(func(tx *gorm.DB) error {
			for i := 0; i < slice.Len(); i++ {
				item := slice.Index(i).Addr().Interface()
				if cfg.Hooks.BeforeCreate != nil {
					if err := cfg.Hooks.BeforeCreate(r, item); err != nil {
						return err
					}
				}
				if err := validate.Struct(item); err != nil {
					return apperr.Validation(formatValidationError(err, cfg.Model))
				}
			}
			if err := tx.Create(slicePtr.Interface()).Error; err != nil {
				return apperr.FromDB(err, cfg.Name)
			}
			return nil
		})
		if txErr != nil {
			return txErr
		}
		if cfg.Hooks.AfterCreate != nil {
			for i := 0; i < slice.Len(); i++ {
				item := slice.Index(i).Addr().Interface()
				runBestEffort(r, cfg.Name, "after_create", func() { cfg.Hooks.AfterCreate(r, item) })
			}
		}
		stripHiddenSlice(slicePtr.Interface(), cfg.HiddenFields)
		return httputil.WriteJSON(w, http.StatusCreated, slicePtr.Interface())
	}
}

func bulkDeleteHandler(gdb *gorm.DB, cfg EntityConfig) apperr.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		var body struct {
			IDs []string `json:"ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return apperr.Validation("invalid JSON body")
		}
		if len(body.IDs) == 0 {
			return apperr.Validation("ids must be a non-empty array")
		}
		if cfg.Hooks.BeforeDelete != nil {
			for _, id := range body.IDs {
				if err := cfg.Hooks.BeforeDelete(r, id); err != nil {
					return err
				}
			}
		}
		record := reflect.New(structTypeOf(cfg.Model)).Interface()
		if err := gdb.WithContext(r.Context()).Where("id IN ?", body.IDs).Delete(record).Error; err != nil {
			return apperr.FromDB(err, cfg.Name)
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func scope(gdb *gorm.DB, r *http.Request, cfg EntityConfig) *gorm.DB {
	q := gdb.WithContext(r.Context()).Model(cfg.Model)
	if cfg.SoftDelete && r.URL.Query().Get("include_deleted") == "true" {
		q = q.Unscoped()
	}
	return q
}

func decodeAndValidate(r *http.Request, dest any) error {
	if err := json.NewDecoder(r.Body).Decode(dest); err != nil {
		return apperr.Validation("invalid JSON body")
	}
	if err := validate.Struct(dest); err != nil {
		return apperr.Validation(formatValidationError(err, dest))
	}
	return nil
}

func buildAllowedPatch(cfg EntityConfig, decoded any, rawMap map[string]json.RawMessage) map[string]any {
	patch := map[string]any{}
	if cfg.schema == nil {
		return patch
	}
	hidden := map[string]struct{}{}
	for _, h := range cfg.HiddenFields {
		hidden[h] = struct{}{}
		if f := cfg.schema.LookUpField(h); f != nil && f.DBName != "" {
			hidden[f.DBName] = struct{}{}
		}
	}
	v := reflect.ValueOf(decoded)
	if v.Kind() == reflect.Pointer {
		v = v.Elem()
	}
	t := v.Type()
	for i := 0; i < t.NumField(); i++ {
		sf := t.Field(i)
		jsonKey := jsonTagName(sf)
		if jsonKey == "-" {
			continue
		}
		if jsonKey == "" {
			jsonKey = sf.Name
		}
		raw, present := rawMap[jsonKey]
		if !present {
			continue
		}
		field := cfg.schema.LookUpField(sf.Name)
		if field == nil || field.DBName == "" {
			continue
		}
		if _, immutable := cfg.immutableColumns[field.DBName]; immutable {
			continue
		}
		if _, isHidden := hidden[field.DBName]; isHidden {
			continue
		}
		if _, isHidden := hidden[sf.Name]; isHidden {
			continue
		}
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			patch[field.DBName] = nil
			continue
		}
		patch[field.DBName] = v.Field(i).Interface()
	}
	return patch
}

func isPartialValidationError(err error, rawMap map[string]json.RawMessage) bool {
	vErrs, ok := err.(validator.ValidationErrors)
	if !ok {
		return false
	}
	for _, fe := range vErrs {
		field := fe.StructField()
		if _, present := rawMap[lowerFirst(field)]; present {
			return false
		}
		if _, present := rawMap[field]; present {
			return false
		}
	}
	return true
}

// ASCII-only: field names come from Go struct identifiers, which the spec
// restricts to ASCII letters/digits/underscore — byte-level slicing is safe.
func lowerFirst(s string) string {
	if s == "" {
		return s
	}
	return strings.ToLower(s[:1]) + s[1:]
}

func jsonTagName(sf reflect.StructField) string {
	tag := sf.Tag.Get("json")
	if tag == "" {
		return ""
	}
	parts := strings.Split(tag, ",")
	return parts[0]
}

func stripHidden(record any, hidden []string) {
	if len(hidden) == 0 {
		return
	}
	v := reflect.ValueOf(record)
	if v.Kind() == reflect.Pointer {
		v = v.Elem()
	}
	if v.Kind() != reflect.Struct {
		return
	}
	t := v.Type()
	for _, name := range hidden {
		sf, ok := findField(t, name)
		if !ok {
			continue
		}
		f := v.FieldByIndex(sf.Index)
		if f.IsValid() && f.CanSet() {
			f.Set(reflect.Zero(f.Type()))
		}
	}
}

func stripHiddenSlice(slice any, hidden []string) {
	if len(hidden) == 0 {
		return
	}
	v := reflect.ValueOf(slice)
	if v.Kind() == reflect.Pointer {
		v = v.Elem()
	}
	if v.Kind() != reflect.Slice {
		return
	}
	for i := 0; i < v.Len(); i++ {
		stripHidden(v.Index(i).Addr().Interface(), hidden)
	}
}

func runBestEffort(r *http.Request, name, phase string, fn func()) {
	defer func() {
		if rec := recover(); rec != nil {
			slog.Error("hook panicked",
				"request_id", requestid.FromContext(r.Context()),
				"entity", name,
				"phase", phase,
				"panic", rec,
			)
		}
	}()
	fn()
}
