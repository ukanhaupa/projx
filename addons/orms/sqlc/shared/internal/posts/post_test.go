package posts

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConfigShape(t *testing.T) {
	cfg := Config((*sql.DB)(nil))
	assert.Equal(t, "post", cfg.Name)
	assert.Equal(t, "/posts", cfg.BasePath)
	assert.Equal(t, "posts", cfg.TableName)
	assert.True(t, cfg.SoftDelete)
	assert.Contains(t, cfg.SearchableFields, "title")
	assert.Contains(t, cfg.SearchableFields, "body")
	assert.Contains(t, cfg.UpdatableColumns, "title")
	require.NotNil(t, cfg.Querier)
}
