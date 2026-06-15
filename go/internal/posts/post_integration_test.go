package posts_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/db"
	"projx.local/go/internal/entities"
	"projx.local/go/internal/posts"
	"projx.local/go/internal/requestid"
)

func setup(t *testing.T) (*httptest.Server, func()) {
	t.Helper()
	if testing.Short() {
		t.Skip("integration test skipped in short mode")
	}
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL not set")
	}
	gdb, err := db.Open(context.Background())
	require.NoError(t, err)
	require.NoError(t, gdb.Migrator().DropTable(&posts.Post{}))
	require.NoError(t, gdb.AutoMigrate(&posts.Post{}))

	entities.Reset()
	entities.Register(posts.Config())

	r := chi.NewRouter()
	r.Use(requestid.Middleware)
	r.Use(apperr.Recoverer)
	for _, cfg := range entities.All() {
		entities.MountEntity(r, gdb, cfg)
	}
	srv := httptest.NewServer(r)
	return srv, func() {
		srv.Close()
		entities.Reset()
	}
}

func do(t *testing.T, method, url string, body any) (*http.Response, []byte) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		require.NoError(t, err)
		reader = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, url, reader)
	require.NoError(t, err)
	if reader != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	t.Cleanup(func() { resp.Body.Close() })
	respBody, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp, respBody
}

func TestPostCRUD(t *testing.T) {
	srv, cleanup := setup(t)
	defer cleanup()

	resp, body := do(t, http.MethodPost, srv.URL+"/posts", map[string]any{
		"title": "First post",
		"body":  "hello world",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
	var created posts.Post
	require.NoError(t, json.Unmarshal(body, &created))
	require.NotEmpty(t, created.ID)
	require.Equal(t, "First post", created.Title)

	resp, body = do(t, http.MethodGet, srv.URL+"/posts/"+created.ID, nil)
	require.Equal(t, http.StatusOK, resp.StatusCode, string(body))
	var fetched posts.Post
	require.NoError(t, json.Unmarshal(body, &fetched))
	require.Equal(t, created.ID, fetched.ID)

	resp, body = do(t, http.MethodPatch, srv.URL+"/posts/"+created.ID, map[string]any{
		"title":     "Updated",
		"published": true,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode, string(body))
	var updated posts.Post
	require.NoError(t, json.Unmarshal(body, &updated))
	require.Equal(t, "Updated", updated.Title)
	require.True(t, updated.Published)

	resp, _ = do(t, http.MethodDelete, srv.URL+"/posts/"+created.ID, nil)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)

	resp, _ = do(t, http.MethodGet, srv.URL+"/posts/"+created.ID, nil)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
}

func TestPostListHidesSoftDeleted(t *testing.T) {
	srv, cleanup := setup(t)
	defer cleanup()

	resp, body := do(t, http.MethodPost, srv.URL+"/posts", map[string]any{"title": "Keeper"})
	require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
	var keeper posts.Post
	require.NoError(t, json.Unmarshal(body, &keeper))

	resp, body = do(t, http.MethodPost, srv.URL+"/posts", map[string]any{"title": "Doomed"})
	require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
	var doomed posts.Post
	require.NoError(t, json.Unmarshal(body, &doomed))

	resp, _ = do(t, http.MethodDelete, srv.URL+"/posts/"+doomed.ID, nil)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)

	resp, body = do(t, http.MethodGet, srv.URL+"/posts", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.True(t, strings.Contains(string(body), keeper.ID))
	require.False(t, strings.Contains(string(body), doomed.ID))
}

func TestPostBulkCreate(t *testing.T) {
	srv, cleanup := setup(t)
	defer cleanup()

	resp, body := do(t, http.MethodPost, srv.URL+"/posts/bulk", []map[string]any{
		{"title": "One"},
		{"title": "Two"},
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
	var created []posts.Post
	require.NoError(t, json.Unmarshal(body, &created))
	require.Len(t, created, 2)
	require.NotEmpty(t, created[0].ID)
	require.NotEmpty(t, created[1].ID)
}

func TestPostValidationRejectsMissingTitle(t *testing.T) {
	srv, cleanup := setup(t)
	defer cleanup()

	resp, body := do(t, http.MethodPost, srv.URL+"/posts", map[string]any{"body": "no title"})
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode, string(body))
	var env struct {
		Detail    string `json:"detail"`
		RequestID string `json:"request_id"`
	}
	require.NoError(t, json.Unmarshal(body, &env))
	require.NotEmpty(t, env.Detail)
	require.NotEmpty(t, env.RequestID)
}
