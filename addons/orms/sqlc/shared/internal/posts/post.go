package posts

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

type Post struct {
	ID        string     `json:"id"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	Published bool       `json:"published"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `json:"-"`
}

type createInput struct {
	ID        *string `json:"id"`
	Title     string  `json:"title"`
	Body      string  `json:"body"`
	Published bool    `json:"published"`
}

type querier struct {
	pool *sql.DB
}

func NewQuerier(pool *sql.DB) entities.Querier {
	return &querier{pool: pool}
}

func Config(pool *sql.DB) entities.EntityConfig {
	return entities.EntityConfig{
		Name:             "post",
		BasePath:         "/posts",
		TableName:        "posts",
		Columns:          []string{"id", "title", "body", "published", "created_at", "updated_at", "deleted_at"},
		UpdatableColumns: []string{"title", "body", "published"},
		SearchableFields: []string{"title", "body"},
		SoftDelete:       true,
		Querier:          NewQuerier(pool),
	}
}

const selectCols = "id, title, body, published, created_at, updated_at, deleted_at"

func (q *querier) Get(ctx context.Context, id string) (any, error) {
	row := q.pool.QueryRowContext(ctx,
		`SELECT `+selectCols+` FROM posts WHERE id = $1 AND deleted_at IS NULL`, id)
	return scanPost(row)
}

func (q *querier) List(ctx context.Context, p entities.ListParams) (entities.Page, error) {
	var where []string
	var args []any
	idx := 1

	if !p.IncludeDeleted {
		where = append(where, "deleted_at IS NULL")
	}
	if p.Search != "" {
		where = append(where, fmt.Sprintf("(title ILIKE $%d OR body ILIKE $%d)", idx, idx))
		args = append(args, "%"+p.Search+"%")
		idx++
	}
	for col, val := range p.Filters {
		if col != "title" && col != "body" && col != "published" {
			continue
		}
		where = append(where, fmt.Sprintf("%s::text = $%d", col, idx))
		args = append(args, val)
		idx++
	}

	whereClause := ""
	if len(where) > 0 {
		whereClause = " WHERE " + strings.Join(where, " AND ")
	}

	var total int64
	if err := q.pool.QueryRowContext(ctx, "SELECT COUNT(*) FROM posts"+whereClause, args...).Scan(&total); err != nil {
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
	rows, err := q.pool.QueryContext(ctx, "SELECT "+selectCols+" FROM posts"+whereClause+limitClause, args...)
	if err != nil {
		return entities.Page{}, err
	}
	defer rows.Close()

	items := make([]any, 0)
	for rows.Next() {
		post, err := scanPostRow(rows)
		if err != nil {
			return entities.Page{}, err
		}
		items = append(items, post)
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
	if strings.TrimSpace(in.Title) == "" {
		return nil, apperr.Validation("field 'title' is required")
	}
	if len(in.Title) > 200 {
		return nil, apperr.Validation("field 'title' must be at most 200 chars")
	}
	id := uuid.V4()
	if in.ID != nil && *in.ID != "" {
		id = *in.ID
	}
	row := q.pool.QueryRowContext(ctx, `
		INSERT INTO posts (id, title, body, published, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		RETURNING `+selectCols, id, in.Title, in.Body, in.Published)
	return scanPost(row)
}

func (q *querier) Update(ctx context.Context, id string, patch map[string]any) (any, error) {
	if len(patch) == 0 {
		row := q.pool.QueryRowContext(ctx,
			`SELECT `+selectCols+` FROM posts WHERE id = $1 AND deleted_at IS NULL`, id)
		return scanPost(row)
	}
	sets := make([]string, 0, len(patch)+1)
	args := make([]any, 0, len(patch)+1)
	idx := 1
	for _, col := range []string{"title", "body", "published"} {
		if v, ok := patch[col]; ok {
			sets = append(sets, fmt.Sprintf("%s = $%d", col, idx))
			args = append(args, v)
			idx++
		}
	}
	if len(sets) == 0 {
		row := q.pool.QueryRowContext(ctx,
			`SELECT `+selectCols+` FROM posts WHERE id = $1 AND deleted_at IS NULL`, id)
		return scanPost(row)
	}
	sets = append(sets, "updated_at = NOW()")
	args = append(args, id)
	row := q.pool.QueryRowContext(ctx,
		`UPDATE posts SET `+strings.Join(sets, ", ")+
			` WHERE id = $`+fmt.Sprint(idx)+` AND deleted_at IS NULL RETURNING `+selectCols, args...)
	return scanPost(row)
}

func (q *querier) Delete(ctx context.Context, id string) error {
	res, err := q.pool.ExecContext(ctx,
		`UPDATE posts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return apperr.NotFound("post")
	}
	return nil
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
		if strings.TrimSpace(in.Title) == "" {
			return nil, apperr.Validation("field 'title' is required")
		}
		id := uuid.V4()
		if in.ID != nil && *in.ID != "" {
			id = *in.ID
		}
		row := tx.QueryRowContext(ctx, `
			INSERT INTO posts (id, title, body, published, created_at, updated_at)
			VALUES ($1, $2, $3, $4, NOW(), NOW())
			RETURNING `+selectCols, id, in.Title, in.Body, in.Published)
		rec, err := scanPost(row)
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

func (q *querier) BulkDelete(ctx context.Context, ids []string) error {
	_, err := q.pool.ExecContext(ctx,
		`UPDATE posts SET deleted_at = NOW() WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, ids)
	return err
}

func scanPost(row *sql.Row) (any, error) {
	var p Post
	err := row.Scan(&p.ID, &p.Title, &p.Body, &p.Published, &p.CreatedAt, &p.UpdatedAt, &p.DeletedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, apperr.NotFound("post")
		}
		return nil, err
	}
	return &p, nil
}

func scanPostRow(rows *sql.Rows) (*Post, error) {
	var p Post
	if err := rows.Scan(&p.ID, &p.Title, &p.Body, &p.Published, &p.CreatedAt, &p.UpdatedAt, &p.DeletedAt); err != nil {
		return nil, err
	}
	return &p, nil
}
