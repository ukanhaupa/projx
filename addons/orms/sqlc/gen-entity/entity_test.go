package __ENTITY_SNAKE__

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConfigShape(t *testing.T) {
	cfg := Config((*sql.DB)(nil))
	assert.Equal(t, "__ENTITY_SNAKE__", cfg.Name)
	assert.Equal(t, "__API_PREFIX__", cfg.BasePath)
	assert.Equal(t, "__TABLE_NAME__", cfg.TableName)
	require.NotNil(t, cfg.Querier)
}
