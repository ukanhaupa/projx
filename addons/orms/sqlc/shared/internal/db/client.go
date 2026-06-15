package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"time"

	_ "github.com/lib/pq"

	"projx.local/go/internal/envutil"
)

func Open(ctx context.Context) (*sql.DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	pool, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	pool.SetMaxIdleConns(envutil.Int("DB_POOL_IDLE", 5))
	pool.SetMaxOpenConns(envutil.Int("DB_POOL_MAX", 20))
	pool.SetConnMaxLifetime(time.Duration(envutil.Int("DB_CONN_MAX_LIFETIME_MIN", 30)) * time.Minute)
	if err := pool.PingContext(ctx); err != nil {
		_ = pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return pool, nil
}

func MustOpen(ctx context.Context) *sql.DB {
	pool, err := Open(ctx)
	if err != nil {
		panic(err)
	}
	return pool
}
