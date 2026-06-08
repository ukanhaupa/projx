package browser

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound           = errors.New("table not found")
	ErrSchemaNotBrowsable = errors.New("schema is not browsable")
)

var systemSchemas = map[string]bool{
	"pg_catalog":         true,
	"information_schema": true,
	"pg_toast":           true,
}

type Column struct {
	Name     string
	DataType string
	UDTName  string
	Nullable bool
	FK       *ForeignKey
}

type ForeignKey struct {
	TargetSchema string
	TargetTable  string
	TargetColumn string
}

type Table struct {
	Schema     string
	Name       string
	Columns    []Column
	PrimaryKey string
}

type Schema struct {
	pool *pgxpool.Pool
}

func NewSchema(pool *pgxpool.Pool) *Schema {
	return &Schema{pool: pool}
}

func (s *Schema) ListSchemas(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT nspname FROM pg_catalog.pg_namespace
		  WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast')
		    AND nspname NOT LIKE 'pg_temp_%'
		    AND nspname NOT LIKE 'pg_toast_temp_%'
		  ORDER BY nspname`)
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

func (s *Schema) IsBrowsable(ctx context.Context, name string) (bool, error) {
	if name == "" || systemSchemas[name] {
		return false, nil
	}
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1)`,
		name,
	).Scan(&exists)
	return exists, err
}

func (s *Schema) Tables(ctx context.Context, schema string) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT table_name FROM information_schema.tables
		  WHERE table_schema = $1 AND table_type = 'BASE TABLE'
		  ORDER BY table_name`, schema)
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

func (s *Schema) Table(ctx context.Context, schema, name string) (*Table, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			 WHERE table_schema = $1 AND table_type = 'BASE TABLE' AND table_name = $2)`,
		schema, name,
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
		schema, name,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tbl := &Table{Schema: schema, Name: name}
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

	pk, err := s.primaryKey(ctx, schema, name)
	if err != nil {
		return nil, err
	}
	tbl.PrimaryKey = pk

	fks, err := s.foreignKeys(ctx, schema, name)
	if err != nil {
		return nil, err
	}
	for i := range tbl.Columns {
		if fk, ok := fks[tbl.Columns[i].Name]; ok {
			fkCopy := fk
			tbl.Columns[i].FK = &fkCopy
		}
	}
	return tbl, nil
}

func (s *Schema) foreignKeys(ctx context.Context, schema, table string) (map[string]ForeignKey, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
		  kcu.column_name,
		  ccu.table_schema AS target_schema,
		  ccu.table_name   AS target_table,
		  ccu.column_name  AS target_column
		FROM information_schema.table_constraints AS tc
		JOIN information_schema.key_column_usage AS kcu
		  ON tc.constraint_name = kcu.constraint_name
		 AND tc.table_schema = kcu.table_schema
		JOIN information_schema.constraint_column_usage AS ccu
		  ON ccu.constraint_name = tc.constraint_name
		 AND ccu.table_schema = tc.table_schema
		WHERE tc.constraint_type = 'FOREIGN KEY'
		  AND tc.table_schema = $1
		  AND tc.table_name = $2
	`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]ForeignKey)
	for rows.Next() {
		var colName string
		var fk ForeignKey
		if err := rows.Scan(&colName, &fk.TargetSchema, &fk.TargetTable, &fk.TargetColumn); err != nil {
			return nil, err
		}
		out[colName] = fk
	}
	return out, rows.Err()
}

func (s *Schema) primaryKey(ctx context.Context, schema, table string) (string, error) {
	var pk string
	err := s.pool.QueryRow(ctx,
		`SELECT a.attname
		   FROM pg_index i
		   JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
		  WHERE i.indrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
		    AND i.indisprimary
		  LIMIT 1`,
		schema, table,
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
