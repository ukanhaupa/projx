package apperr

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRecovererPassthrough(t *testing.T) {
	handler := Recoverer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "ok", rec.Body.String())
}

func TestFromDBNilPassthrough(t *testing.T) {
	assert.Nil(t, FromDB(nil, "Post"))
}

func TestFromDBNoRowsMapsToNotFound(t *testing.T) {
	err := FromDB(sql.ErrNoRows, "Post")
	var ae AppError
	require.ErrorAs(t, err, &ae)
	assert.Equal(t, http.StatusNotFound, ae.Status)
	assert.Equal(t, "Post not found", ae.Detail)
}

func TestFromDBUniqueViolationMapsToConflict(t *testing.T) {
	err := FromDB(&pgconn.PgError{Code: "23505"}, "Post")
	var ae AppError
	require.ErrorAs(t, err, &ae)
	assert.Equal(t, http.StatusConflict, ae.Status)
	assert.Equal(t, "Post already exists", ae.Detail)
}

func TestFromDBForeignKeyViolationMapsToConflict(t *testing.T) {
	err := FromDB(&pgconn.PgError{Code: "23503"}, "Post")
	var ae AppError
	require.ErrorAs(t, err, &ae)
	assert.Equal(t, http.StatusConflict, ae.Status)
}
