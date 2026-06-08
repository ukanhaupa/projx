package browser

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("table not found")

type Column struct {
	Name     string
	DataType string
	UDTName  string
	Nullable bool
}

type Table struct {
	Schema     string
	Name       string
	Columns    []Column
	PrimaryKey string
}

type Schema struct {
	pool *pgxpool.Pool
	name string
}

func NewSchema(pool *pgxpool.Pool, name string) *Schema {
	return &Schema{pool: pool, name: name}
}

func (s *Schema) Name() string {
	return s.name
}

func (s *Schema) Tables(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT table_name FROM information_schema.tables
		  WHERE table_schema = $1 AND table_type = 'BASE TABLE'
		  ORDER BY table_name`, s.name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

func (s *Schema) Table(ctx context.Context, name string) (*Table, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			 WHERE table_schema = $1 AND table_type = 'BASE TABLE' AND table_name = $2)`,
		s.name, name,
	).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}

	rows, err := s.pool.Query(ctx,
		`SELECT column_name, data_type, udt_name, is_nullable
		   FROM information_schema.columns
		  WHERE table_schema = $1 AND table_name = $2
		  ORDER BY ordinal_position`,
		s.name, name,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tbl := &Table{Schema: s.name, Name: name}
	for rows.Next() {
		var c Column
		var nullable string
		if err := rows.Scan(&c.Name, &c.DataType, &c.UDTName, &nullable); err != nil {
			return nil, err
		}
		c.Nullable = nullable == "YES"
		tbl.Columns = append(tbl.Columns, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	pk, err := s.primaryKey(ctx, name)
	if err != nil {
		return nil, err
	}
	tbl.PrimaryKey = pk
	return tbl, nil
}

func (s *Schema) primaryKey(ctx context.Context, table string) (string, error) {
	var pk string
	err := s.pool.QueryRow(ctx,
		`SELECT a.attname
		   FROM pg_index i
		   JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
		  WHERE i.indrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
		    AND i.indisprimary
		  LIMIT 1`,
		s.name, table,
	).Scan(&pk)
	if err != nil {
		return "", nil
	}
	return pk, nil
}

func (t *Table) HasColumn(name string) bool {
	return t.Column(name) != nil
}

func (t *Table) Column(name string) *Column {
	for i := range t.Columns {
		if t.Columns[i].Name == name {
			return &t.Columns[i]
		}
	}
	return nil
}
