package __ENTITY_SNAKE__

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"projx.local/go/ent"
	__ENT_PKG_IMPORT__
	"projx.local/go/internal/apperr"
	"projx.local/go/internal/entities"
	"projx.local/go/internal/uuid"
)

type createInput struct {
	ID *string `json:"id"`
__CREATE_INPUT_FIELDS__
}

type querier struct {
	client *ent.Client
}

func NewQuerier(client *ent.Client) entities.Querier {
	return &querier{client: client}
}

func Config(client *ent.Client) entities.EntityConfig {
	return entities.EntityConfig{
		Name:             "__ENTITY_SNAKE__",
		BasePath:         "__API_PREFIX__",
		TableName:        "__TABLE_NAME__",
		Columns:          []string{__COLUMNS_ARRAY__},
		UpdatableColumns: []string{__UPDATABLE_COLUMNS_ARRAY__},
		SearchableFields: []string{__SEARCHABLE_FIELDS_ARRAY__},
		SoftDelete:       __SOFT_DELETE__,
		Querier:          NewQuerier(client),
	}
}

func (q *querier) Get(ctx context.Context, id string) (any, error) {
	qry := q.client.__ENTITY_PASCAL__.Query().Where(__ENT_PKG__.ID(id))
__GET_SOFT_DELETE_FILTER__
	rec, err := qry.Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, apperr.NotFound("__ENTITY_SNAKE__")
		}
		return nil, err
	}
	return rec, nil
}

func (q *querier) List(ctx context.Context, p entities.ListParams) (entities.Page, error) {
	qry := q.client.__ENTITY_PASCAL__.Query()
__LIST_SOFT_DELETE_BLOCK__
__SEARCH_BLOCK__
__FILTER_BLOCK__

	total, err := qry.Clone().Count(ctx)
	if err != nil {
		return entities.Page{}, err
	}

	if len(p.OrderBy) == 0 {
		qry = qry.Order(ent.Desc(__ENT_PKG__.FieldCreatedAt))
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
__CREATE_VALIDATION__
	id := uuid.V4()
	if in.ID != nil && *in.ID != "" {
		id = *in.ID
	}
	rec, err := q.client.__ENTITY_PASCAL__.Create().
		SetID(id).
__CREATE_SETTERS__
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
	upd := q.client.__ENTITY_PASCAL__.UpdateOneID(id)
__UPDATE_SOFT_DELETE_FILTER__
__UPDATE_SETTERS__
	upd = upd.SetUpdatedAt(time.Now())
	rec, err := upd.Save(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, apperr.NotFound("__ENTITY_SNAKE__")
		}
		return nil, err
	}
	return rec, nil
}

func (q *querier) Delete(ctx context.Context, id string) error {
__DELETE_BODY__
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
__CREATE_VALIDATION__
		id := uuid.V4()
		if in.ID != nil && *in.ID != "" {
			id = *in.ID
		}
		rec, cerr := tx.__ENTITY_PASCAL__.Create().
			SetID(id).
__CREATE_SETTERS__
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

func (q *querier) BulkDelete(ctx context.Context, ids []string) (int, error) {
__BULK_DELETE_BODY__
}

var _ = strings.TrimSpace
