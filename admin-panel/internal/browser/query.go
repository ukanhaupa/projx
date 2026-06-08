package browser

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultPageSize = 50
	maxPageSize     = 200
)

type Row map[string]any

type Page struct {
	Columns []string
	Rows    []Row
	Offset  int
	Limit   int
	Total   int
	HasNext bool
	Query   Query
}

type Repo struct {
	pool *pgxpool.Pool
}

func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

func ident(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func qualified(t *Table) string {
	return ident(t.Schema) + "." + ident(t.Name)
}

func (r *Repo) List(ctx context.Context, t *Table, q Query) (*Page, error) {
	limit := q.Limit
	if limit <= 0 || limit > maxPageSize {
		limit = defaultPageSize
	}
	offset := q.Offset
	if offset < 0 {
		offset = 0
	}

	cols := make([]string, len(t.Columns))
	names := make([]string, len(t.Columns))
	for i, c := range t.Columns {
		cols[i] = ident(c.Name)
		names[i] = c.Name
	}

	where, args, err := buildWhere(t, q)
	if err != nil {
		return nil, err
	}
	order, err := buildOrderBy(t, q.Sort)
	if err != nil {
		return nil, err
	}

	sql := fmt.Sprintf(
		"SELECT %s FROM %s%s%s LIMIT %d OFFSET %d",
		strings.Join(cols, ", "), qualified(t), where, order, limit+1, offset,
	)
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	page := &Page{Columns: names, Offset: offset, Limit: limit, Query: q}
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		row := make(Row, len(names))
		for i, name := range names {
			row[name] = vals[i]
		}
		page.Rows = append(page.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(page.Rows) > limit {
		page.HasNext = true
		page.Rows = page.Rows[:limit]
	}
	return page, nil
}

func (r *Repo) Count(ctx context.Context, t *Table, q Query) (int, error) {
	where, args, err := buildWhere(t, q)
	if err != nil {
		return 0, err
	}
	sql := "SELECT COUNT(*) FROM " + qualified(t) + where
	var n int
	if err := r.pool.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

func (r *Repo) StreamAll(ctx context.Context, t *Table, q Query, cap int, fn func(Row) error) error {
	cols := make([]string, len(t.Columns))
	names := make([]string, len(t.Columns))
	for i, c := range t.Columns {
		cols[i] = ident(c.Name)
		names[i] = c.Name
	}
	where, args, err := buildWhere(t, q)
	if err != nil {
		return err
	}
	order, err := buildOrderBy(t, q.Sort)
	if err != nil {
		return err
	}
	limit := cap
	if limit <= 0 {
		limit = 10000
	}
	sql := fmt.Sprintf(
		"SELECT %s FROM %s%s%s LIMIT %d",
		strings.Join(cols, ", "), qualified(t), where, order, limit,
	)
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return err
		}
		row := make(Row, len(names))
		for i, name := range names {
			row[name] = vals[i]
		}
		if err := fn(row); err != nil {
			return err
		}
	}
	return rows.Err()
}

func (r *Repo) Get(ctx context.Context, t *Table, id string) (Row, error) {
	if t.PrimaryKey == "" {
		return nil, fmt.Errorf("table %s has no primary key", t.Name)
	}
	cols := make([]string, len(t.Columns))
	names := make([]string, len(t.Columns))
	for i, c := range t.Columns {
		cols[i] = ident(c.Name)
		names[i] = c.Name
	}
	sql := fmt.Sprintf(
		"SELECT %s FROM %s WHERE %s = $1",
		strings.Join(cols, ", "), qualified(t), ident(t.PrimaryKey),
	)
	vals, err := r.pool.Query(ctx, sql, coercePK(t, id))
	if err != nil {
		return nil, err
	}
	defer vals.Close()
	if !vals.Next() {
		return nil, ErrNotFound
	}
	raw, err := vals.Values()
	if err != nil {
		return nil, err
	}
	row := make(Row, len(names))
	for i, name := range names {
		row[name] = raw[i]
	}
	return row, nil
}

func (r *Repo) Update(ctx context.Context, t *Table, id string, data map[string]string) error {
	if t.PrimaryKey == "" {
		return fmt.Errorf("table %s has no primary key", t.Name)
	}
	sets := make([]string, 0, len(data))
	args := make([]any, 0, len(data)+1)
	i := 1
	for _, c := range t.Columns {
		if c.Name == t.PrimaryKey {
			continue
		}
		raw, ok := data[c.Name]
		if !ok {
			continue
		}
		val, err := coerce(&c, raw)
		if err != nil {
			return err
		}
		sets = append(sets, fmt.Sprintf("%s = $%d", ident(c.Name), i))
		args = append(args, val)
		i++
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, coercePK(t, id))
	sql := fmt.Sprintf(
		"UPDATE %s SET %s WHERE %s = $%d",
		qualified(t), strings.Join(sets, ", "), ident(t.PrimaryKey), i,
	)
	tag, err := r.pool.Exec(ctx, sql, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) Insert(ctx context.Context, t *Table, data map[string]string) error {
	cols := make([]string, 0, len(data))
	placeholders := make([]string, 0, len(data))
	args := make([]any, 0, len(data))
	i := 1
	for _, c := range t.Columns {
		raw, ok := data[c.Name]
		if !ok || strings.TrimSpace(raw) == "" {
			continue
		}
		val, err := coerce(&c, raw)
		if err != nil {
			return err
		}
		cols = append(cols, ident(c.Name))
		placeholders = append(placeholders, "$"+strconv.Itoa(i))
		args = append(args, val)
		i++
	}
	if len(cols) == 0 {
		return fmt.Errorf("no insertable columns provided")
	}
	sql := fmt.Sprintf(
		"INSERT INTO %s (%s) VALUES (%s)",
		qualified(t), strings.Join(cols, ", "), strings.Join(placeholders, ", "),
	)
	_, err := r.pool.Exec(ctx, sql, args...)
	return err
}

func (r *Repo) Delete(ctx context.Context, t *Table, id string) error {
	if t.PrimaryKey == "" {
		return fmt.Errorf("table %s has no primary key", t.Name)
	}
	sql := fmt.Sprintf(
		"DELETE FROM %s WHERE %s = $1",
		qualified(t), ident(t.PrimaryKey),
	)
	tag, err := r.pool.Exec(ctx, sql, coercePK(t, id))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func coercePK(t *Table, id string) any {
	c := t.Column(t.PrimaryKey)
	if c != nil && strings.HasPrefix(c.UDTName, "int") {
		if n, err := strconv.ParseInt(id, 10, 64); err == nil {
			return n
		}
	}
	return id
}
