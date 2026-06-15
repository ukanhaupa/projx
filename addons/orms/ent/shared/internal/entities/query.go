package entities

import (
	"net/url"
	"strconv"
	"strings"
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

var reservedQueryKeys = map[string]struct{}{
	"page": {}, "page_size": {}, "search": {}, "order_by": {}, "expand": {}, "include_deleted": {},
}

func ParseListParams(params url.Values, cfg EntityConfig) ListParams {
	page := 1
	pageSize := DefaultPageSize
	if v := params.Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			page = n
		}
	}
	if v := params.Get("page_size"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			pageSize = clamp(n, 1, MaxPageSize)
		}
	}

	cols := columnSet(cfg)
	filters := map[string]string{}
	for key, vals := range params {
		if _, reserved := reservedQueryKeys[key]; reserved {
			continue
		}
		if _, ok := cols[key]; !ok {
			continue
		}
		if len(vals) > 0 && vals[0] != "" {
			filters[key] = vals[0]
		}
	}

	var orderBy []OrderClause
	if v := params.Get("order_by"); v != "" {
		for _, part := range strings.Split(v, ",") {
			p := strings.TrimSpace(part)
			if p == "" {
				continue
			}
			desc := false
			if strings.HasPrefix(p, "-") {
				desc = true
				p = p[1:]
			}
			if _, ok := cols[p]; !ok {
				continue
			}
			orderBy = append(orderBy, OrderClause{Column: p, Desc: desc})
		}
	}

	includeDeleted := cfg.SoftDelete && params.Get("include_deleted") == "true"

	return ListParams{
		Limit:          pageSize,
		Offset:         (page - 1) * pageSize,
		Search:         params.Get("search"),
		OrderBy:        orderBy,
		Filters:        filters,
		IncludeDeleted: includeDeleted,
	}
}

func columnSet(cfg EntityConfig) map[string]struct{} {
	out := make(map[string]struct{}, len(cfg.Columns))
	for _, c := range cfg.Columns {
		out[c] = struct{}{}
	}
	return out
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

func PageMetaFor(total int64, p ListParams) Pagination {
	pageSize := p.Limit
	if pageSize <= 0 {
		pageSize = DefaultPageSize
	}
	pageNum := p.Offset/pageSize + 1
	totalPages := total / int64(pageSize)
	if total%int64(pageSize) != 0 {
		totalPages++
	}
	return Pagination{
		Page:         pageNum,
		PageSize:     pageSize,
		TotalRecords: total,
		TotalPages:   totalPages,
	}
}
