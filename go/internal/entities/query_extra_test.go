package entities

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseQueryExpandCommaSeparated(t *testing.T) {
	opts := parseQuery(url.Values{"expand": {"author, comments"}})
	assert.Equal(t, []string{"author", "comments"}, opts.Expand)
}

func TestParseQueryEmptyExpand(t *testing.T) {
	opts := parseQuery(url.Values{"expand": {""}})
	assert.Empty(t, opts.Expand)
}

func TestParseQueryPageBelowOneClampedToOne(t *testing.T) {
	opts := parseQuery(url.Values{"page": {"0"}})
	assert.Equal(t, 1, opts.Page)

	opts = parseQuery(url.Values{"page": {"-7"}})
	assert.Equal(t, 1, opts.Page)
}

func TestParseQueryPageSizeBelowOneFallsBackToDefault(t *testing.T) {
	opts := parseQuery(url.Values{"page_size": {"-3"}})
	assert.Equal(t, DefaultPageSize, opts.PageSize)
}

func TestParseQueryOrderByMixedDirectionsAndWhitespace(t *testing.T) {
	opts := parseQuery(url.Values{"order_by": {"name, -created_at"}})
	assert.Equal(t, []string{"name", "-created_at"}, opts.OrderBy)
}

func TestParseQueryFiltersDropEmptyValues(t *testing.T) {
	opts := parseQuery(url.Values{
		"published": {""},
		"status":    {"draft"},
	})
	_, hasPublished := opts.Filters["published"]
	assert.False(t, hasPublished)
	assert.Equal(t, "draft", opts.Filters["status"])
}

func TestParseQueryReservedKeysIncludedInResolution(t *testing.T) {
	opts := parseQuery(url.Values{
		"include_deleted": {"true"},
		"author":          {"bob"},
	})
	_, included := opts.Filters["include_deleted"]
	assert.False(t, included)
	assert.Equal(t, "bob", opts.Filters["author"])
}

func TestColumnSetFromQModel(t *testing.T) {
	cols := columnSet(EntityConfig{Model: &qmodel{}})
	assert.Equal(t, "title", cols["title"])
	assert.Equal(t, "body", cols["body"])
	assert.Equal(t, "id", cols["id"])
}

func TestResolveColumnNoSchemaUsesColumnSet(t *testing.T) {
	col := resolveColumn(EntityConfig{Model: &qmodel{}}, "title")
	assert.Equal(t, "title", col)
}

func TestResolveColumnUnknownKeyReturnsEmpty(t *testing.T) {
	col := resolveColumn(EntityConfig{Model: &qmodel{}}, "nope")
	assert.Equal(t, "", col)
}

func TestDefaultSnake(t *testing.T) {
	assert.Equal(t, "i_d", defaultSnake("ID"))
	assert.Equal(t, "created_at", defaultSnake("CreatedAt"))
	assert.Equal(t, "title", defaultSnake("Title"))
}

func TestFieldNames(t *testing.T) {
	names := fieldNames(&qmodel{})
	_, ok := names["Title"]
	assert.True(t, ok)
	_, ok = names["ID"]
	assert.True(t, ok)
}

func TestColumnSetOnNonStructReturnsEmpty(t *testing.T) {
	got := columnSet(EntityConfig{Model: 42})
	assert.Empty(t, got)
}

func TestFieldNamesOnNonStructReturnsEmpty(t *testing.T) {
	got := fieldNames("not a struct")
	assert.Empty(t, got)
}
