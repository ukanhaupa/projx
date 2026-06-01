package posts

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"projx.local/go/ent"
	"projx.local/go/ent/post"
	"projx.local/go/internal/apperr"
	"projx.local/go/internal/entities"
	"projx.local/go/internal/uuid"
)

type createInput struct {
	ID        *string `json:"id"`
	Title     string  `json:"title"`
	Body      string  `json:"body"`
	Published bool    `json:"published"`
}

type querier struct {
	client *ent.Client
}

func NewQuerier(client *ent.Client) entities.Querier {
	return &querier{client: client}
}

func Config(client *ent.Client) entities.EntityConfig {
	return entities.EntityConfig{
		Name:             "post",
		BasePath:         "/posts",
		TableName:        "posts",
		Columns:          []string{"id", "title", "body", "published", "created_at", "updated_at", "deleted_at"},
		UpdatableColumns: []string{"title", "body", "published"},
		SearchableFields: []string{"title", "body"},
		SoftDelete:       true,
		Querier:          NewQuerier(client),
	}
}

func (q *querier) Get(ctx context.Context, id string) (any, error) {
	rec, err := q.client.Post.Query().
		Where(post.ID(id), post.DeletedAtIsNil()).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, apperr.NotFound("post")
		}
		return nil, err
	}
	return rec, nil
}

func (q *querier) List(ctx context.Context, p entities.ListParams) (entities.Page, error) {
	qry := q.client.Post.Query()
	if !p.IncludeDeleted {
		qry = qry.Where(post.DeletedAtIsNil())
	}
	if p.Search != "" {
		needle := "%" + p.Search + "%"
		qry = qry.Where(
			post.Or(
				post.TitleContainsFold(needle),
				post.BodyContainsFold(needle),
			),
		)
	}
	for col, val := range p.Filters {
		switch col {
		case "title":
			qry = qry.Where(post.Title(val))
		case "body":
			qry = qry.Where(post.Body(val))
		case "published":
			qry = qry.Where(post.Published(val == "true"))
		}
	}

	total, err := qry.Clone().Count(ctx)
	if err != nil {
		return entities.Page{}, err
	}

	if len(p.OrderBy) == 0 {
		qry = qry.Order(ent.Desc(post.FieldCreatedAt))
	} else {
		for _, o := range p.OrderBy {
			if o.Desc {
				qry = qry.Order(ent.Desc(o.Column))
			} else {
				qry = qry.Order(ent.Asc(o.Column))
			}
		}
	}

	recs, err := qry.Limit(p.Limit).Offset(p.Offset).All(ctx)
	if err != nil {
		return entities.Page{}, err
	}
	items := make([]any, 0, len(recs))
	for _, r := range recs {
		items = append(items, r)
	}
	return entities.Page{Items: items, Total: int64(total)}, nil
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
	rec, err := q.client.Post.Create().
		SetID(id).
		SetTitle(in.Title).
		SetBody(in.Body).
		SetPublished(in.Published).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	return rec, nil
}

func (q *querier) Update(ctx context.Context, id string, patch map[string]any) (any, error) {
	if len(patch) == 0 {
		return q.Get(ctx, id)
	}
	upd := q.client.Post.UpdateOneID(id).Where(post.DeletedAtIsNil())
	if v, ok := patch["title"]; ok {
		if s, ok := v.(string); ok {
			upd = upd.SetTitle(s)
		}
	}
	if v, ok := patch["body"]; ok {
		if s, ok := v.(string); ok {
			upd = upd.SetBody(s)
		}
	}
	if v, ok := patch["published"]; ok {
		if b, ok := v.(bool); ok {
			upd = upd.SetPublished(b)
		}
	}
	upd = upd.SetUpdatedAt(time.Now())
	rec, err := upd.Save(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, apperr.NotFound("post")
		}
		return nil, err
	}
	return rec, nil
}

func (q *querier) Delete(ctx context.Context, id string) error {
	now := time.Now()
	n, err := q.client.Post.Update().
		Where(post.ID(id), post.DeletedAtIsNil()).
		SetDeletedAt(now).
		Save(ctx)
	if err != nil {
		return err
	}
	if n == 0 {
		return apperr.NotFound("post")
	}
	return nil
}

func (q *querier) BulkCreate(ctx context.Context, payloads [][]byte) ([]any, error) {
	tx, err := q.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	out := make([]any, 0, len(payloads))
	for _, payload := range payloads {
		var in createInput
		if uerr := json.Unmarshal(payload, &in); uerr != nil {
			err = apperr.Validation("invalid JSON body")
			return nil, err
		}
		if strings.TrimSpace(in.Title) == "" {
			err = apperr.Validation("field 'title' is required")
			return nil, err
		}
		id := uuid.V4()
		if in.ID != nil && *in.ID != "" {
			id = *in.ID
		}
		rec, cerr := tx.Post.Create().
			SetID(id).
			SetTitle(in.Title).
			SetBody(in.Body).
			SetPublished(in.Published).
			Save(ctx)
		if cerr != nil {
			err = cerr
			return nil, err
		}
		out = append(out, rec)
	}
	if cerr := tx.Commit(); cerr != nil {
		err = cerr
		return nil, err
	}
	return out, nil
}

func (q *querier) BulkDelete(ctx context.Context, ids []string) error {
	now := time.Now()
	_, err := q.client.Post.Update().
		Where(post.IDIn(ids...), post.DeletedAtIsNil()).
		SetDeletedAt(now).
		Save(ctx)
	if err != nil && ent.IsNotFound(err) {
		return apperr.NotFound("post")
	}
	return err
}
