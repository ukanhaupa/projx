package apperr

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"projx.local/go/internal/requestid"
)

func decodeEnvelope(t *testing.T, body []byte) envelope {
	t.Helper()
	var env envelope
	require.NoError(t, json.Unmarshal(body, &env))
	return env
}

func TestHReturnsNoBodyOnNil(t *testing.T) {
	h := H(func(w http.ResponseWriter, _ *http.Request) error {
		w.WriteHeader(http.StatusOK)
		return nil
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Empty(t, rec.Body.String())
}

func TestHMapsAppErrorToStatusAndEnvelope(t *testing.T) {
	h := H(func(_ http.ResponseWriter, _ *http.Request) error {
		return NotFound("widget")
	})

	rec := httptest.NewRecorder()
	rid := "rid-1234"
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(requestid.HeaderName, rid)
	wrapped := requestid.Middleware(h)
	wrapped.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
	env := decodeEnvelope(t, rec.Body.Bytes())
	assert.Equal(t, "widget not found", env.Detail)
	assert.Equal(t, rid, env.RequestID)
}

func TestHMapsValidationErrorTo422(t *testing.T) {
	h := H(func(_ http.ResponseWriter, _ *http.Request) error {
		return Validation("bad input")
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	env := decodeEnvelope(t, rec.Body.Bytes())
	assert.Equal(t, "bad input", env.Detail)
}

func TestHMapsUnknownErrorTo500(t *testing.T) {
	h := H(func(_ http.ResponseWriter, _ *http.Request) error {
		return errors.New("kaboom")
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	env := decodeEnvelope(t, rec.Body.Bytes())
	assert.Equal(t, "internal server error", env.Detail)
}

func TestRecovererCatchesPanic(t *testing.T) {
	panicker := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		panic("oh no")
	})
	rec := httptest.NewRecorder()
	rid := "rid-pan"
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(requestid.HeaderName, rid)

	wrapped := requestid.Middleware(Recoverer(panicker))
	assert.NotPanics(t, func() { wrapped.ServeHTTP(rec, req) })
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	env := decodeEnvelope(t, rec.Body.Bytes())
	assert.Equal(t, "internal server error", env.Detail)
	assert.Equal(t, rid, env.RequestID)
}

func TestRecovererPassesThroughOnNoPanic(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	rec := httptest.NewRecorder()
	Recoverer(ok).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "ok", rec.Body.String())
}

func TestFromDBNilPassthrough(t *testing.T) {
	assert.Nil(t, FromDB(nil, "Post"))
}

func TestFromDBRecordNotFoundMapsToNotFound(t *testing.T) {
	err := FromDB(gorm.ErrRecordNotFound, "Post")
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
	assert.Equal(t, "Post foreign key violation", ae.Detail)
}

func TestFromDBOtherPgErrorReturnsOriginal(t *testing.T) {
	original := &pgconn.PgError{Code: "42601"}
	err := FromDB(original, "Post")
	assert.Same(t, original, err)
}

func TestFromDBNonPGErrorPassesThrough(t *testing.T) {
	original := errors.New("network down")
	err := FromDB(original, "Post")
	assert.Same(t, original, err)
}
