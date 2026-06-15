package entities

import (
	"fmt"
	"strings"
	"sync"
)

var (
	registryMu sync.RWMutex
	registry   []EntityConfig
)

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
	if cfg.Querier == nil {
		return fmt.Errorf("querier is required")
	}
	if cfg.TableName == "" {
		return fmt.Errorf("table name is required")
	}
	if len(cfg.Columns) == 0 {
		return fmt.Errorf("columns must be non-empty for filter validation")
	}
	if len(cfg.Hooks.BeforeCreateFields) > 0 {
		cols := make(map[string]struct{}, len(cfg.Columns))
		for _, c := range cfg.Columns {
			cols[c] = struct{}{}
		}
		for _, name := range cfg.Hooks.BeforeCreateFields {
			if _, ok := cols[name]; !ok {
				return fmt.Errorf("BeforeCreateFields: %q is not a column on %s", name, cfg.TableName)
			}
		}
	}
	return nil
}
