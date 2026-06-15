package uuid

import (
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var canonicalV4 = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestV4Format(t *testing.T) {
	id := V4()
	require.Len(t, id, 36)
	assert.Regexp(t, canonicalV4, id)
}

func TestV4VersionAndVariantBits(t *testing.T) {
	id := V4()
	assert.Equal(t, byte('4'), id[14])
	variant := id[19]
	assert.Contains(t, "89ab", string(variant))
}

func TestV4Uniqueness(t *testing.T) {
	seen := make(map[string]struct{}, 1000)
	for i := 0; i < 1000; i++ {
		id := V4()
		_, dup := seen[id]
		require.False(t, dup, "collision at iteration %d: %s", i, id)
		seen[id] = struct{}{}
	}
	assert.Len(t, seen, 1000)
}
