package __ENTITY_SNAKE__

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/entities"
	"projx.local/go/internal/uuid"
)

type __ENTITY_PASCAL__ struct {
__STRUCT_FIELDS__
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `json:"-"`
}

type createInput struct {
	ID *string `json:"id"`
__CREATE_INPUT_FIELDS__
}

type querier struct {
	pool *sql.DB
}

func NewQuerier(pool *sql.DB) entities.Querier {
	return &querier{pool: pool}
}

func Config(pool *sql.DB) entities.EntityConfig {
	return entities.EntityConfig{
		Name:             "__ENTITY_SNAKE__",
		BasePath:         "__API_PREFIX__",
		TableName:        "__TABLE_NAME__",
		Columns:          []string{__COLUMNS_ARRAY__},
		UpdatableColumns: []string{__UPDATABLE_COLUMNS_ARRAY__},
		SearchableFields: []string{__SEARCHABLE_FIELDS_ARRAY__},
		SoftDelete:       __SOFT_DELETE__,
		Querier:          NewQuerier(pool),
	}
}

const selectCols = "__SELECT_COLS_STR__"
const tableName = "__TABLE_NAME__"

func (q *querier) Get(ctx context.Context, id string) (any, error) {
	row := q.pool.QueryRowContext(ctx,
		`SELECT `+selectCols+` FROM `+tableName+` WHERE id = $1__SOFT_DELETE_FILTER__`, id)
	return scan__ENTITY_PASCAL__(row)
}

func (q *querier) List(ctx context.Context, p entities.ListParams) (entities.Page, error) {
	var where []string
	var args []any
	idx := 1
__SOFT_DELETE_LIST_BLOCK__
	if p.Search != "" {
		clauses := __SEARCH_CLAUSES__
		if len(clauses) > 0 {
			where = append(where, "("+strings.Join(clauses, " OR ")+")")
			for range clauses {
				args = append(args, "%"+p.Search+"%")
				idx++
			}
		}
	}

__FILTER_BLOCK__

	whereClause := ""
	if len(where) > 0 {
		whereClause = " WHERE " + strings.Join(where, " AND ")
	}

	var total int64
	if err := q.pool.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+tableName+whereClause, args...).Scan(&total); err != nil {
		return entities.Page{}, err
	}

	order := "created_at DESC"
	if len(p.OrderBy) > 0 {
		parts := make([]string, 0, len(p.OrderBy))
		for _, o := range p.OrderBy {
			dir := "ASC"
			if o.Desc {
				dir = "DESC"
			}
			parts = append(parts, o.Column+" "+dir)
		}
		order = strings.Join(parts, ", ")
	}

	args = append(args, p.Limit, p.Offset)
	limitClause := fmt.Sprintf(" ORDER BY %s LIMIT $%d OFFSET $%d", order, idx, idx+1)
	rows, err := q.pool.QueryContext(ctx, "SELECT "+selectCols+" FROM "+tableName+whereClause+limitClause, args...)
	if err != nil {
		return entities.Page{}, err
	}
	defer rows.Close()

	items := make([]any, 0)
	for rows.Next() {
		rec, err := scan__ENTITY_PASCAL__Row(rows)
		if err != nil {
			return entities.Page{}, err
		}
		items = append(items, rec)
	}
	if err := rows.Err(); err != nil {
		return entities.Page{}, err
	}
	return entities.Page{Items: items, Total: total}, nil
}

func (q *querier) Create(ctx context.Context, payload []byte) (any, error) {
	var in createInput
	if err := json.Unmarshal(payload, &in); err != nil {
		return nil, apperr.Validation("invalid JSON body")
	}
__CREATE_VALIDATION__
	id := uuid.V4()
	if in.ID != nil && *in.ID != "" {
		id = *in.ID
	}
	row := q.pool.QueryRowContext(ctx, `
		INSERT INTO `+tableName+` (__INSERT_COLUMNS__)
		VALUES (__INSERT_PLACEHOLDERS__)
		RETURNING `+selectCols, __INSERT_VALUES__)
	return scan__ENTITY_PASCAL__(row)
}

func (q *querier) Update(ctx context.Context, id string, patch map[string]any) (any, error) {
	if len(patch) == 0 {
		row := q.pool.QueryRowContext(ctx,
			`SELECT `+selectCols+` FROM `+tableName+` WHERE id = $1__SOFT_DELETE_FILTER__`, id)
		return scan__ENTITY_PASCAL__(row)
	}
	sets := make([]string, 0, len(patch)+1)
	args := make([]any, 0, len(patch)+1)
	idx := 1
	for _, col := range []string{__UPDATABLE_COLUMNS_ARRAY__} {
		if v, ok := patch[col]; ok {
			sets = append(sets, fmt.Sprintf("%s = $%d", col, idx))
			args = append(args, v)
			idx++
		}
	}
	if len(sets) == 0 {
		row := q.pool.QueryRowContext(ctx,
			`SELECT `+selectCols+` FROM `+tableName+` WHERE id = $1__SOFT_DELETE_FILTER__`, id)
		return scan__ENTITY_PASCAL__(row)
	}
	sets = append(sets, "updated_at = NOW()")
	args = append(args, id)
	row := q.pool.QueryRowContext(ctx,
		`UPDATE `+tableName+` SET `+strings.Join(sets, ", ")+
			` WHERE id = $`+fmt.Sprint(idx)+`__SOFT_DELETE_FILTER__ RETURNING `+selectCols, args...)
	return scan__ENTITY_PASCAL__(row)
}

func (q *querier) Delete(ctx context.Context, id string) error {
__DELETE_BODY__
}

func (q *querier) BulkCreate(ctx context.Context, payloads [][]byte) ([]any, error) {
	tx, err := q.pool.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	out := make([]any, 0, len(payloads))
	for _, payload := range payloads {
		var in createInput
		if err := json.Unmarshal(payload, &in); err != nil {
			return nil, apperr.Validation("invalid JSON body")
		}
__CREATE_VALIDATION__
		id := uuid.V4()
		if in.ID != nil && *in.ID != "" {
			id = *in.ID
		}
		row := tx.QueryRowContext(ctx, `
			INSERT INTO `+tableName+` (__INSERT_COLUMNS__)
			VALUES (__INSERT_PLACEHOLDERS__)
			RETURNING `+selectCols, __INSERT_VALUES__)
		rec, err := scan__ENTITY_PASCAL__(row)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

func (q *querier) BulkDelete(ctx context.Context, ids []string) (int, error) {
__BULK_DELETE_BODY__
}

func scan__ENTITY_PASCAL__(row *sql.Row) (any, error) {
	var rec __ENTITY_PASCAL__
	err := row.Scan(__SCAN_ARGS__)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, apperr.NotFound("__ENTITY_SNAKE__")
		}
		return nil, err
	}
	return &rec, nil
}

func scan__ENTITY_PASCAL__Row(rows *sql.Rows) (*__ENTITY_PASCAL__, error) {
	var rec __ENTITY_PASCAL__
	if err := rows.Scan(__SCAN_ARGS__); err != nil {
		return nil, err
	}
	return &rec, nil
}
