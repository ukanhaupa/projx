package db

import (
	"context"
	"fmt"
	"os"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"projx.local/go/internal/envutil"
)

func Open(ctx context.Context) (*gorm.DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	gdb, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		return nil, fmt.Errorf("acquire sql.DB: %w", err)
	}
	sqlDB.SetMaxIdleConns(envutil.Int("DB_POOL_IDLE", 5))
	sqlDB.SetMaxOpenConns(envutil.Int("DB_POOL_MAX", 20))
	sqlDB.SetConnMaxLifetime(time.Duration(envutil.Int("DB_CONN_MAX_LIFETIME_MIN", 30)) * time.Minute)
	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return gdb, nil
}

func MustOpen(ctx context.Context) *gorm.DB {
	gdb, err := Open(ctx)
	if err != nil {
		panic(err)
	}
	return gdb
}
