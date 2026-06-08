package browser

import (
	"fmt"
	"strconv"
	"strings"
)

func buildWhere(t *Table, q Query) (string, []any, error) {
	var clauses []string
	var args []any
	idx := 1

	for _, f := range q.Filters {
		col := t.Column(f.Column)
		if col == nil {
			return "", nil, fmt.Errorf("unknown column: %s", f.Column)
		}
		clause, used, err := buildFilterClause(col, f, &idx)
		if err != nil {
			return "", nil, err
		}
		clauses = append(clauses, clause)
		args = append(args, used...)
	}

	if s := strings.TrimSpace(q.Search); s != "" {
		searchCols := textishColumns(t)
		if len(searchCols) > 0 {
			ors := make([]string, len(searchCols))
			for i, c := range searchCols {
				ors[i] = fmt.Sprintf("%s::text ILIKE $%d", ident(c.Name), idx)
			}
			args = append(args, "%"+s+"%")
			idx++
			clauses = append(clauses, "("+strings.Join(ors, " OR ")+")")
		}
	}

	if len(clauses) == 0 {
		return "", args, nil
	}
	return " WHERE " + strings.Join(clauses, " AND "), args, nil
}

func buildFilterClause(col *Column, f Filter, idx *int) (string, []any, error) {
	id := ident(f.Column)
	switch f.Operator {
	case OpIsNull:
		return id + " IS NULL", nil, nil
	case OpIsNotNull:
		return id + " IS NOT NULL", nil, nil
	case OpEq, OpNeq, OpGt, OpGte, OpLt, OpLte:
		if len(f.Values) == 0 {
			return "", nil, fmt.Errorf("operator %s on %s needs a value", f.Operator, f.Column)
		}
		val, err := coerce(col, f.Values[0])
		if err != nil {
			return "", nil, err
		}
		clause := fmt.Sprintf("%s %s $%d", id, f.Operator.SQL(), *idx)
		*idx++
		return clause, []any{val}, nil
	case OpILike, OpStartsWith, OpEndsWith:
		if len(f.Values) == 0 {
			return "", nil, fmt.Errorf("operator %s on %s needs a value", f.Operator, f.Column)
		}
		pattern := escapeLike(f.Values[0])
		switch f.Operator {
		case OpStartsWith:
			pattern = pattern + "%"
		case OpEndsWith:
			pattern = "%" + pattern
		default:
			pattern = "%" + pattern + "%"
		}
		clause := fmt.Sprintf("%s::text ILIKE $%d", id, *idx)
		*idx++
		return clause, []any{pattern}, nil
	case OpIn:
		if len(f.Values) == 0 {
			return "", nil, fmt.Errorf("operator IN on %s needs at least one value", f.Column)
		}
		placeholders := make([]string, len(f.Values))
		args := make([]any, len(f.Values))
		for i, v := range f.Values {
			val, err := coerce(col, v)
			if err != nil {
				return "", nil, err
			}
			placeholders[i] = "$" + strconv.Itoa(*idx)
			args[i] = val
			*idx++
		}
		return fmt.Sprintf("%s IN (%s)", id, strings.Join(placeholders, ", ")), args, nil
	case OpBetween:
		if len(f.Values) < 2 {
			return "", nil, fmt.Errorf("operator BETWEEN on %s needs two values", f.Column)
		}
		lo, err := coerce(col, f.Values[0])
		if err != nil {
			return "", nil, err
		}
		hi, err := coerce(col, f.Values[1])
		if err != nil {
			return "", nil, err
		}
		clause := fmt.Sprintf("%s BETWEEN $%d AND $%d", id, *idx, *idx+1)
		*idx += 2
		return clause, []any{lo, hi}, nil
	case OpContainsKey:
		if len(f.Values) == 0 {
			return "", nil, fmt.Errorf("contains_key on %s needs a value", f.Column)
		}
		clause := fmt.Sprintf("%s ? $%d", id, *idx)
		*idx++
		return clause, []any{f.Values[0]}, nil
	case OpHas:
		if len(f.Values) == 0 {
			return "", nil, fmt.Errorf("has on %s needs a value", f.Column)
		}
		clause := fmt.Sprintf("$%d = ANY(%s)", *idx, id)
		*idx++
		return clause, []any{f.Values[0]}, nil
	}
	return "", nil, fmt.Errorf("unsupported operator: %s", f.Operator)
}

func buildOrderBy(t *Table, keys []SortKey) (string, error) {
	if len(keys) == 0 {
		if t.PrimaryKey != "" {
			return " ORDER BY " + ident(t.PrimaryKey), nil
		}
		return "", nil
	}
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		if t.Column(k.Column) == nil {
			return "", fmt.Errorf("unknown sort column: %s", k.Column)
		}
		dir := "ASC"
		if k.Desc {
			dir = "DESC"
		}
		parts = append(parts, ident(k.Column)+" "+dir)
	}
	return " ORDER BY " + strings.Join(parts, ", "), nil
}

func textishColumns(t *Table) []Column {
	var out []Column
	for _, c := range t.Columns {
		switch c.UDTName {
		case "text", "citext", "varchar", "bpchar":
			out = append(out, c)
		}
	}
	return out
}

func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}
