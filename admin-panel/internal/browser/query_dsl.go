package browser

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

type Operator string

const (
	OpEq          Operator = "eq"
	OpNeq         Operator = "neq"
	OpGt          Operator = "gt"
	OpGte         Operator = "gte"
	OpLt          Operator = "lt"
	OpLte         Operator = "lte"
	OpILike       Operator = "ilike"
	OpStartsWith  Operator = "starts_with"
	OpEndsWith    Operator = "ends_with"
	OpIsNull      Operator = "is_null"
	OpIsNotNull   Operator = "is_not_null"
	OpIn          Operator = "in"
	OpBetween     Operator = "between"
	OpContainsKey Operator = "contains_key"
	OpHas         Operator = "has"
)

func (o Operator) SQL() string {
	switch o {
	case OpEq:
		return "="
	case OpNeq:
		return "!="
	case OpGt:
		return ">"
	case OpGte:
		return ">="
	case OpLt:
		return "<"
	case OpLte:
		return "<="
	}
	return ""
}

type Filter struct {
	Column   string
	Operator Operator
	Values   []string
}

type SortKey struct {
	Column string
	Desc   bool
}

type Query struct {
	Filters []Filter
	Search  string
	Sort    []SortKey
	Offset  int
	Limit   int
}

func ParseQuery(values url.Values) Query {
	q := Query{
		Search: strings.TrimSpace(values.Get("q")),
	}
	if v := values.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			q.Offset = n
		}
	}
	if v := values.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			q.Limit = n
		}
	}
	if raw := values.Get("sort"); raw != "" {
		for _, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			desc := false
			if strings.HasPrefix(part, "-") {
				desc = true
				part = strings.TrimPrefix(part, "-")
			}
			q.Sort = append(q.Sort, SortKey{Column: part, Desc: desc})
		}
	}
	filters := map[string]*Filter{}
	order := []string{}
	for key, vs := range values {
		if !strings.HasPrefix(key, "f.") {
			continue
		}
		rest := strings.TrimPrefix(key, "f.")
		dot := strings.LastIndex(rest, ".")
		if dot < 1 {
			continue
		}
		col := rest[:dot]
		op := Operator(rest[dot+1:])
		composite := col + "|" + string(op)
		if _, exists := filters[composite]; !exists {
			filters[composite] = &Filter{Column: col, Operator: op}
			order = append(order, composite)
		}
		filters[composite].Values = append(filters[composite].Values, vs...)
	}
	for _, key := range order {
		q.Filters = append(q.Filters, *filters[key])
	}
	return q
}

func (q Query) Encode() string {
	values := url.Values{}
	if q.Search != "" {
		values.Set("q", q.Search)
	}
	if q.Offset > 0 {
		values.Set("offset", strconv.Itoa(q.Offset))
	}
	if q.Limit > 0 {
		values.Set("limit", strconv.Itoa(q.Limit))
	}
	if len(q.Sort) > 0 {
		parts := make([]string, len(q.Sort))
		for i, s := range q.Sort {
			if s.Desc {
				parts[i] = "-" + s.Column
			} else {
				parts[i] = s.Column
			}
		}
		values.Set("sort", strings.Join(parts, ","))
	}
	for _, f := range q.Filters {
		key := fmt.Sprintf("f.%s.%s", f.Column, f.Operator)
		for _, v := range f.Values {
			values.Add(key, v)
		}
	}
	return values.Encode()
}

func (q Query) WithOffset(o int) Query {
	q.Offset = o
	return q
}

func (q Query) WithoutPagination() Query {
	q.Offset = 0
	q.Limit = 0
	return q
}
