package serviceconfig

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/envutil"
	"projx.local/go/internal/uuid"
)

const defaultCacheTTLSeconds = 600

type cacheEntry struct {
	value     string
	expiresAt time.Time
}

type Service struct {
	db    *sql.DB
	key   []byte
	ttl   time.Duration
	mu    sync.RWMutex
	cache map[string]cacheEntry
	now   func() time.Time
}

func NewService(db *sql.DB) (*Service, error) {
	key, err := loadKey()
	if err != nil {
		return nil, err
	}
	ttl := time.Duration(envutil.Int("CONFIG_CACHE_TTL_SECONDS", defaultCacheTTLSeconds)) * time.Second
	return &Service{
		db:    db,
		key:   key,
		ttl:   ttl,
		cache: map[string]cacheEntry{},
		now:   time.Now,
	}, nil
}

func loadKey() ([]byte, error) {
	raw := os.Getenv("CRED_ENCRYPTION_KEY")
	if raw == "" {
		return nil, errors.New(`CRED_ENCRYPTION_KEY is required. Generate one with: python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"`)
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("CRED_ENCRYPTION_KEY base64 decode: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("CRED_ENCRYPTION_KEY must decode to 32 bytes (got %d)", len(key))
	}
	return key, nil
}

func (s *Service) Get(ctx context.Context, key string) (string, error) {
	s.mu.RLock()
	if entry, ok := s.cache[key]; ok && entry.expiresAt.After(s.now()) {
		s.mu.RUnlock()
		return entry.value, nil
	}
	s.mu.RUnlock()

	var encrypted string
	err := s.db.QueryRowContext(ctx,
		`SELECT config FROM service_configs WHERE purpose = $1 AND is_active = TRUE`, key,
	).Scan(&encrypted)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", apperr.NotFound("service_config:" + key)
		}
		return "", err
	}

	plaintext, err := decrypt(s.key, encrypted)
	if err != nil {
		return "", fmt.Errorf("decrypt %q: %w", key, err)
	}

	s.mu.Lock()
	s.cache[key] = cacheEntry{value: plaintext, expiresAt: s.now().Add(s.ttl)}
	s.mu.Unlock()
	return plaintext, nil
}

func (s *Service) Set(ctx context.Context, key, value string) error {
	encrypted, err := encrypt(s.key, value)
	if err != nil {
		return fmt.Errorf("encrypt %q: %w", key, err)
	}
	id := uuid.V4()
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO service_configs (id, purpose, config, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, TRUE, NOW(), NOW())
		ON CONFLICT (purpose) DO UPDATE
		SET config = EXCLUDED.config, is_active = TRUE, updated_at = NOW()
	`, id, key, encrypted)
	if err != nil {
		return apperr.FromDB(err, "service_config")
	}
	s.Invalidate(key)
	return nil
}

func (s *Service) Delete(ctx context.Context, key string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM service_configs WHERE purpose = $1`, key)
	if err != nil {
		return apperr.FromDB(err, "service_config")
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return apperr.NotFound("service_config:" + key)
	}
	s.Invalidate(key)
	return nil
}

func (s *Service) Invalidate(key string) {
	s.mu.Lock()
	delete(s.cache, key)
	s.mu.Unlock()
}

func (s *Service) InvalidateAll() {
	s.mu.Lock()
	s.cache = map[string]cacheEntry{}
	s.mu.Unlock()
}

func (s *Service) GetConfig(ctx context.Context, key string) (map[string]any, error) {
	plaintext, err := s.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(plaintext), &out); err != nil {
		return nil, fmt.Errorf("service_config %q payload is not JSON: %w", key, err)
	}
	return out, nil
}

func (s *Service) SetConfig(ctx context.Context, key string, config map[string]any) error {
	buf, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("marshal service_config %q: %w", key, err)
	}
	return s.Set(ctx, key, string(buf))
}
