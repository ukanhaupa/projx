package entities

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/requestid"
)

type stubQuerier struct {
	bulkAffected int
	bulkErr      error
}

func (s *stubQuerier) List(context.Context, ListParams) (Page, error) {
	return Page{}, nil
}
func (s *stubQuerier) Get(context.Context, string) (any, error)       { return nil, nil }
func (s *stubQuerier) Create(context.Context, []byte) (any, error)    { return nil, nil }
func (s *stubQuerier) Update(context.Context, string, map[string]any) (any, error) {
	return nil, nil
}
func (s *stubQuerier) Delete(context.Context, string) error             { return nil }
func (s *stubQuerier) BulkCreate(context.Context, [][]byte) ([]any, error) { return nil, nil }
func (s *stubQuerier) BulkDelete(_ context.Context, _ []string) (int, error) {
	return s.bulkAffected, s.bulkErr
}

func mountStub(q Querier) chi.Router {
	r := chi.NewRouter()
	r.Use(requestid.Middleware)
	r.Use(apperr.Recoverer)
	MountEntity(r, EntityConfig{
		Name:      "thing",
		BasePath:  "/things",
		TableName: "things",
		Columns:   []string{"id"},
		Querier:   q,
	})
	return r
}

func TestBulkDeleteReturnsNoContentWhenRowsAffected(t *testing.T) {
	router := mountStub(&stubQuerier{bulkAffected: 2})
	body, _ := json.Marshal(map[string][]string{"ids": {"a", "b"}})
	req := httptest.NewRequest(http.MethodDelete, "/things/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestBulkDeleteReturnsNotFoundWhenZeroAffected(t *testing.T) {
	router := mountStub(&stubQuerier{bulkAffected: 0})
	body, _ := json.Marshal(map[string][]string{"ids": {"missing-1", "missing-2"}})
	req := httptest.NewRequest(http.MethodDelete, "/things/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestBulkDeleteRejectsEmptyIDs(t *testing.T) {
	router := mountStub(&stubQuerier{bulkAffected: 99})
	body, _ := json.Marshal(map[string][]string{"ids": {}})
	req := httptest.NewRequest(http.MethodDelete, "/things/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}
