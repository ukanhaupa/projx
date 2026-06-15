package __ENTITY_SNAKE__

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"projx.local/go/ent"
)

func TestConfigShape(t *testing.T) {
	cfg := Config((*ent.Client)(nil))
	assert.Equal(t, "__ENTITY_SNAKE__", cfg.Name)
	assert.Equal(t, "__API_PREFIX__", cfg.BasePath)
	assert.Equal(t, "__TABLE_NAME__", cfg.TableName)
	require.NotNil(t, cfg.Querier)
}
