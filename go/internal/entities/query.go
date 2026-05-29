package entities

import (
	"net/url"
	"reflect"
	"strconv"
	"strings"

	"gorm.io/gorm"
)

const (
	DefaultPageSize = 25
	MaxPageSize     = 100
)

type Pagination struct {
	Page         int   `json:"page"`
	PageSize     int   `json:"page_size"`
	TotalRecords int64 `json:"total_records"`
	TotalPages   int64 `json:"total_pages"`
}

type PageResult struct {
	Data       any        `json:"data"`
	Pagination Pagination `json:"pagination"`
}

type QueryOptions struct {
	Page     int
	PageSize int
	OrderBy  []string
	Search   string
	Expand   []string
	Filters  map[string]string
}

var reservedQueryKeys = []string{"page", "page_size", "search", "order_by", "expand", "include_deleted"}

var reservedQuerySet = func() map[string]struct{} {
	m := make(map[string]struct{}, len(reservedQueryKeys))
	for _, k := range reservedQueryKeys {
		m[k] = struct{}{}
	}
	return m
}()

func parseQuery(params url.Values) QueryOptions {
	opts := QueryOptions{
		Page:     1,
		PageSize: DefaultPageSize,
		Filters:  map[string]string{},
	}
	if v := params.Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			opts.Page = n
		}
	}
	if v := params.Get("page_size"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			opts.PageSize = clamp(n, 1, MaxPageSize)
		}
	}
	if v := params.Get("order_by"); v != "" {
		for _, part := range strings.Split(v, ",") {
			if p := strings.TrimSpace(part); p != "" {
				opts.OrderBy = append(opts.OrderBy, p)
			}
		}
	}
	if v := params.Get("search"); v != "" {
		opts.Search = v
	}
	if v := params.Get("expand"); v != "" {
		for _, part := range strings.Split(v, ",") {
			if p := strings.TrimSpace(part); p != "" {
				opts.Expand = append(opts.Expand, p)
			}
		}
	}
	for key, vals := range params {
		if _, reserved := reservedQuerySet[key]; reserved {
			continue
		}
		if len(vals) > 0 && vals[0] != "" {
			opts.Filters[key] = vals[0]
		}
	}
	return opts
}

func ApplyFilters(db *gorm.DB, params url.Values, cfg EntityConfig) (*gorm.DB, QueryOptions) {
	opts := parseQuery(params)
	q := db

	columns := columnSet(cfg)
	for key, val := range opts.Filters {
		if _, ok := columns[key]; ok {
			q = q.Where(key+" = ?", val)
		}
	}

	if opts.Search != "" && len(cfg.SearchableFields) > 0 {
		var clauses []string
		var args []any
		needle := "%" + opts.Search + "%"
		for _, f := range cfg.SearchableFields {
			col := resolveColumn(cfg, f)
			if col == "" {
				continue
			}
			clauses = append(clauses, col+" ILIKE ?")
			args = append(args, needle)
		}
		if len(clauses) > 0 {
			q = q.Where(strings.Join(clauses, " OR "), args...)
		}
	}

	for _, ord := range opts.OrderBy {
		dir := "ASC"
		key := ord
		if strings.HasPrefix(ord, "-") {
			dir = "DESC"
			key = ord[1:]
		}
		if col, ok := columns[key]; ok && col != "" {
			q = q.Order(col + " " + dir)
		}
	}

	if cfg.schema != nil {
		for _, exp := range opts.Expand {
			if f := cfg.schema.LookUpField(exp); f != nil {
				q = q.Preload(f.Name)
			}
		}
	} else {
		fields := fieldNames(cfg.Model)
		for _, exp := range opts.Expand {
			if _, ok := fields[exp]; ok {
				q = q.Preload(exp)
			}
		}
	}

	return q, opts
}

func Paginate(db *gorm.DB, opts QueryOptions, dest any) (Pagination, error) {
	var total int64
	if err := db.Model(dest).Count(&total).Error; err != nil {
		return Pagination{}, err
	}
	offset := (opts.Page - 1) * opts.PageSize
	if err := db.Limit(opts.PageSize).Offset(offset).Find(dest).Error; err != nil {
		return Pagination{}, err
	}
	totalPages := total / int64(opts.PageSize)
	if total%int64(opts.PageSize) != 0 {
		totalPages++
	}
	return Pagination{
		Page:         opts.Page,
		PageSize:     opts.PageSize,
		TotalRecords: total,
		TotalPages:   totalPages,
	}, nil
}

func clamp(n, lo, hi int) int {
	if n < lo {
		return lo
	}
	if n > hi {
		return hi
	}
	return n
}

func columnSet(cfg EntityConfig) map[string]string {
	out := map[string]string{}
	if cfg.schema != nil {
		for dbName := range cfg.schema.FieldsByDBName {
			out[dbName] = dbName
		}
		for goName, f := range cfg.schema.FieldsByName {
			if f.DBName != "" {
				out[goName] = f.DBName
			}
		}
		return out
	}
	t := structTypeOf(cfg.Model)
	if t.Kind() != reflect.Struct {
		return out
	}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		name := defaultSnake(f.Name)
		if tag := f.Tag.Get("json"); tag != "" && tag != "-" {
			if parts := strings.Split(tag, ","); parts[0] != "" {
				name = parts[0]
			}
		}
		out[name] = name
	}
	return out
}

func resolveColumn(cfg EntityConfig, key string) string {
	if cfg.schema != nil {
		if f, ok := cfg.schema.FieldsByDBName[key]; ok {
			return f.DBName
		}
		if f := cfg.schema.LookUpField(key); f != nil {
			return f.DBName
		}
		return ""
	}
	cols := columnSet(cfg)
	return cols[key]
}

func fieldNames(model any) map[string]struct{} {
	out := map[string]struct{}{}
	t := structTypeOf(model)
	if t.Kind() != reflect.Struct {
		return out
	}
	for i := 0; i < t.NumField(); i++ {
		out[t.Field(i).Name] = struct{}{}
	}
	return out
}

func defaultSnake(s string) string {
	var b strings.Builder
	for i, r := range s {
		if i > 0 && r >= 'A' && r <= 'Z' {
			b.WriteByte('_')
		}
		if r >= 'A' && r <= 'Z' {
			b.WriteRune(r + 32)
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}
