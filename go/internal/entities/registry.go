package entities

import (
	"fmt"
	"reflect"
	"strings"
	"sync"

	"gorm.io/gorm/schema"
)

var (
	registryMu sync.RWMutex
	registry   []EntityConfig
)

var immutableFieldNames = []string{"ID", "CreatedAt", "UpdatedAt", "DeletedAt"}

func Register(cfg EntityConfig) {
	if err := validateConfig(cfg); err != nil {
		panic(fmt.Errorf("entities.Register(%q): %w", cfg.Name, err))
	}
	registryMu.Lock()
	defer registryMu.Unlock()
	registry = append(registry, cfg)
}

func All() []EntityConfig {
	registryMu.RLock()
	defer registryMu.RUnlock()
	out := make([]EntityConfig, len(registry))
	copy(out, registry)
	return out
}

func Reset() {
	registryMu.Lock()
	defer registryMu.Unlock()
	registry = nil
}

func validateConfig(cfg EntityConfig) error {
	if cfg.Name == "" {
		return fmt.Errorf("name is required")
	}
	if !strings.HasPrefix(cfg.BasePath, "/") {
		return fmt.Errorf("BasePath must start with /")
	}
	if cfg.Model == nil {
		return fmt.Errorf("model is required")
	}
	t := reflect.TypeOf(cfg.Model)
	if t.Kind() != reflect.Pointer || t.Elem().Kind() != reflect.Struct {
		return fmt.Errorf("model must be a pointer to a struct")
	}
	elem := t.Elem()
	if len(cfg.Hooks.BeforeCreateFields) > 0 {
		for _, name := range cfg.Hooks.BeforeCreateFields {
			if !hasField(elem, name) {
				return fmt.Errorf("BeforeCreateFields: %q is not a field on %s", name, elem.Name())
			}
		}
	}
	return nil
}

func immutableColumnSet(s *schema.Schema) map[string]struct{} {
	out := map[string]struct{}{}
	for _, name := range immutableFieldNames {
		if f := s.LookUpField(name); f != nil && f.DBName != "" {
			out[f.DBName] = struct{}{}
		}
	}
	return out
}
