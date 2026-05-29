package posts

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConfigShape(t *testing.T) {
	cfg := Config()
	assert.Equal(t, "post", cfg.Name)
	assert.Equal(t, "/posts", cfg.BasePath)
	assert.True(t, cfg.SoftDelete)
	assert.Contains(t, cfg.SearchableFields, "title")
	assert.Contains(t, cfg.SearchableFields, "body")
	require.NotNil(t, cfg.Model)
	_, ok := cfg.Model.(*Post)
	assert.True(t, ok, "Model must be a *Post")
}

func TestBeforeCreateAssignsIDWhenEmpty(t *testing.T) {
	p := &Post{}
	require.NoError(t, p.BeforeCreate(nil))
	assert.NotEmpty(t, p.ID)
	assert.Len(t, p.ID, 36)
}

func TestBeforeCreatePreservesExistingID(t *testing.T) {
	p := &Post{ID: "preset-id"}
	require.NoError(t, p.BeforeCreate(nil))
	assert.Equal(t, "preset-id", p.ID)
}
