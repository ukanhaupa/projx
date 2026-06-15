package requestid

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIncomingHeaderPreserved(t *testing.T) {
	var seen string
	h := Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen = FromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(HeaderName, "abc-123")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, "abc-123", seen)
	assert.Equal(t, "abc-123", rec.Header().Get(HeaderName))
}

func TestMissingHeaderGetsGenerated(t *testing.T) {
	var seen string
	h := Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen = FromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.NotEmpty(t, seen)
	assert.Len(t, seen, 36)
	assert.Equal(t, seen, rec.Header().Get(HeaderName))
}

func TestFromContextEmptyByDefault(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	assert.Empty(t, FromContext(req.Context()))
}
