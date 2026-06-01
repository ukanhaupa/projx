package posts

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"projx.local/go/ent"
)

func TestConfigShape(t *testing.T) {
	cfg := Config((*ent.Client)(nil))
	assert.Equal(t, "post", cfg.Name)
	assert.Equal(t, "/posts", cfg.BasePath)
	assert.Equal(t, "posts", cfg.TableName)
	assert.True(t, cfg.SoftDelete)
	require.NotNil(t, cfg.Querier)
	assert.Contains(t, cfg.Columns, "id")
	assert.Contains(t, cfg.Columns, "title")
	assert.Contains(t, cfg.UpdatableColumns, "title")
}
