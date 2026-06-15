package entities

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
)

type qmodel struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Body  string `json:"body"`
}

func TestParseQueryDefaults(t *testing.T) {
	opts := parseQuery(url.Values{})
	assert.Equal(t, 1, opts.Page)
	assert.Equal(t, DefaultPageSize, opts.PageSize)
	assert.Empty(t, opts.OrderBy)
	assert.Empty(t, opts.Search)
}

func TestParseQueryPageSizeClampedToMax(t *testing.T) {
	v := url.Values{"page_size": {"5000"}}
	opts := parseQuery(v)
	assert.Equal(t, MaxPageSize, opts.PageSize)
}

func TestParseQueryPageSizeRejectsNonPositive(t *testing.T) {
	v := url.Values{"page_size": {"0"}}
	opts := parseQuery(v)
	assert.Equal(t, DefaultPageSize, opts.PageSize)
}

func TestParseQueryOrderByCommaSeparated(t *testing.T) {
	v := url.Values{"order_by": {"-created_at, title"}}
	opts := parseQuery(v)
	assert.Equal(t, []string{"-created_at", "title"}, opts.OrderBy)
}

func TestParseQueryReservedParamsExcludedFromFilters(t *testing.T) {
	v := url.Values{
		"page":      {"2"},
		"page_size": {"50"},
		"search":    {"hello"},
		"order_by":  {"title"},
		"published": {"true"},
	}
	opts := parseQuery(v)
	assert.Equal(t, map[string]string{"published": "true"}, opts.Filters)
}

func TestColumnSetPicksJSONTagFallback(t *testing.T) {
	cols := columnSet(EntityConfig{Model: &qmodel{}})
	assert.Contains(t, cols, "id")
	assert.Contains(t, cols, "title")
	assert.Contains(t, cols, "body")
}

func TestClamp(t *testing.T) {
	assert.Equal(t, 1, clamp(0, 1, 10))
	assert.Equal(t, 10, clamp(99, 1, 10))
	assert.Equal(t, 5, clamp(5, 1, 10))
}
