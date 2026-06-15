package entities

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type sampleModel struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

func TestRegisterValidConfig(t *testing.T) {
	Reset()
	t.Cleanup(Reset)

	Register(EntityConfig{
		Name:     "sample",
		Model:    &sampleModel{},
		BasePath: "/samples",
	})

	all := All()
	require.Len(t, all, 1)
	assert.Equal(t, "sample", all[0].Name)
}

func TestRegisterPanicsOnMissingBasePath(t *testing.T) {
	Reset()
	t.Cleanup(Reset)

	assert.Panics(t, func() {
		Register(EntityConfig{
			Name:     "sample",
			Model:    &sampleModel{},
			BasePath: "samples",
		})
	})
}

func TestRegisterPanicsOnNonPointerModel(t *testing.T) {
	Reset()
	t.Cleanup(Reset)

	assert.Panics(t, func() {
		Register(EntityConfig{
			Name:     "sample",
			Model:    sampleModel{},
			BasePath: "/samples",
		})
	})
}

func TestRegisterPanicsOnNilModel(t *testing.T) {
	Reset()
	t.Cleanup(Reset)

	assert.Panics(t, func() {
		Register(EntityConfig{
			Name:     "sample",
			BasePath: "/samples",
		})
	})
}

func TestRegisterPanicsOnBogusBeforeCreateFields(t *testing.T) {
	Reset()
	t.Cleanup(Reset)

	assert.Panics(t, func() {
		Register(EntityConfig{
			Name:     "sample",
			Model:    &sampleModel{},
			BasePath: "/samples",
			Hooks: Hooks{
				BeforeCreateFields: []string{"NonExistentField"},
			},
		})
	})
}

func TestRegisterAcceptsValidBeforeCreateFields(t *testing.T) {
	Reset()
	t.Cleanup(Reset)

	Register(EntityConfig{
		Name:     "sample",
		Model:    &sampleModel{},
		BasePath: "/samples",
		Hooks: Hooks{
			BeforeCreateFields: []string{"Title", "id"},
		},
	})

	assert.Len(t, All(), 1)
}

func TestRegisterPanicsOnEmptyName(t *testing.T) {
	Reset()
	t.Cleanup(Reset)

	assert.Panics(t, func() {
		Register(EntityConfig{
			Model:    &sampleModel{},
			BasePath: "/samples",
		})
	})
}

func TestAllReturnsCopy(t *testing.T) {
	Reset()
	t.Cleanup(Reset)

	Register(EntityConfig{
		Name:     "sample",
		Model:    &sampleModel{},
		BasePath: "/samples",
	})

	snapshot := All()
	snapshot[0].Name = "mutated"
	assert.Equal(t, "sample", All()[0].Name)
}
