package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	_ "github.com/lib/pq"

	"projx.local/go/ent"
	"projx.local/go/internal/envutil"
)

type Handles struct {
	Client *ent.Client
	Pool   *sql.DB
}

func (h Handles) Close() error {
	if err := h.Client.Close(); err != nil {
		return err
	}
	return h.Pool.Close()
}

func Open(ctx context.Context) (Handles, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return Handles{}, fmt.Errorf("DATABASE_URL is required")
	}
	pool, err := sql.Open("postgres", dsn)
	if err != nil {
		return Handles{}, fmt.Errorf("open postgres: %w", err)
	}
	pool.SetMaxIdleConns(envutil.Int("DB_POOL_IDLE", 5))
	pool.SetMaxOpenConns(envutil.Int("DB_POOL_MAX", 20))
	pool.SetConnMaxLifetime(time.Duration(envutil.Int("DB_CONN_MAX_LIFETIME_MIN", 30)) * time.Minute)
	if err := pool.PingContext(ctx); err != nil {
		_ = pool.Close()
		return Handles{}, fmt.Errorf("ping postgres: %w", err)
	}
	drv := entsql.OpenDB(dialect.Postgres, pool)
	client := ent.NewClient(ent.Driver(drv))
	return Handles{Client: client, Pool: pool}, nil
}

func MustOpen(ctx context.Context) Handles {
	h, err := Open(ctx)
	if err != nil {
		panic(err)
	}
	return h
}
