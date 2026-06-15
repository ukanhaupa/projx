package envutil

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIntFallbackWhenUnset(t *testing.T) {
	t.Setenv("PROJX_TEST_KNOB", "")
	assert.Equal(t, 7, Int("PROJX_TEST_KNOB_UNSET_xyz", 7))
}

func TestIntParsesValidInteger(t *testing.T) {
	t.Setenv("PROJX_TEST_KNOB", "42")
	assert.Equal(t, 42, Int("PROJX_TEST_KNOB", 7))
}

func TestIntFallbackOnNonInteger(t *testing.T) {
	t.Setenv("PROJX_TEST_KNOB", "not-an-int")
	assert.Equal(t, 7, Int("PROJX_TEST_KNOB", 7))
}

func TestIntFallbackOnNonPositive(t *testing.T) {
	t.Setenv("PROJX_TEST_KNOB", "0")
	assert.Equal(t, 9, Int("PROJX_TEST_KNOB", 9))

	t.Setenv("PROJX_TEST_KNOB", "-3")
	assert.Equal(t, 9, Int("PROJX_TEST_KNOB", 9))
}

func TestIntFallbackOnEmpty(t *testing.T) {
	t.Setenv("PROJX_TEST_KNOB", "")
	assert.Equal(t, 5, Int("PROJX_TEST_KNOB", 5))
}
