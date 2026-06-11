package db

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"adminpanel/internal/testenv"
)

func migrateTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := testenv.DatabaseURL()
	ctx := context.Background()
	pool, err := Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `DROP SCHEMA IF EXISTS admin_panel CASCADE`); err != nil {
		t.Fatalf("reset: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DROP SCHEMA IF EXISTS admin_panel CASCADE`)
	})
	return pool
}

func embeddedMigrationCount(t *testing.T) int {
	t.Helper()
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		t.Fatalf("read embedded migrations: %v", err)
	}
	n := 0
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			n++
		}
	}
	return n
}

func TestMigrateCreatesSchemaMigrationsTable(t *testing.T) {
	pool := migrateTestPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatalf("first migrate: %v", err)
	}
	var exists bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS(
		  SELECT 1 FROM information_schema.tables
		  WHERE table_schema = 'admin_panel' AND table_name = 'schema_migrations'
		)
	`).Scan(&exists); err != nil {
		t.Fatalf("query: %v", err)
	}
	if !exists {
		t.Fatal("expected admin_panel.schema_migrations table to exist")
	}
}

func TestMigrateRecordsAppliedMigrations(t *testing.T) {
	pool := migrateTestPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatalf("first migrate: %v", err)
	}
	var name string
	if err := pool.QueryRow(ctx,
		`SELECT name FROM admin_panel.schema_migrations ORDER BY applied_at ASC LIMIT 1`,
	).Scan(&name); err != nil {
		t.Fatalf("query: %v", err)
	}
	if name != "0001_init.sql" {
		t.Fatalf("expected 0001_init.sql recorded, got %q", name)
	}
}

func TestMigrateIsIdempotentAcrossReruns(t *testing.T) {
	pool := migrateTestPool(t)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if err := Migrate(ctx, pool); err != nil {
			t.Fatalf("run %d: %v", i, err)
		}
	}
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM admin_panel.schema_migrations`,
	).Scan(&count); err != nil {
		t.Fatalf("query: %v", err)
	}
	if expected := embeddedMigrationCount(t); count != expected {
		t.Fatalf("expected exactly %d recorded migrations after 3 reruns, got %d", expected, count)
	}
}

func TestMigrateConcurrentBootsAreSafe(t *testing.T) {
	pool := migrateTestPool(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	errs := make(chan error, 5)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := Migrate(ctx, pool); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent migrate failed: %v", err)
	}
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM admin_panel.schema_migrations`,
	).Scan(&count); err != nil {
		t.Fatalf("query: %v", err)
	}
	if expected := embeddedMigrationCount(t); count != expected {
		t.Fatalf("expected %d recorded migrations after 5 concurrent boots, got %d", expected, count)
	}
}

func TestMigrateRollsBackOnError(t *testing.T) {
	pool := migrateTestPool(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `CREATE SCHEMA admin_panel`); err != nil {
		t.Fatalf("setup schema: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`CREATE TABLE admin_panel.schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
	); err != nil {
		t.Fatalf("setup tracking: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO admin_panel.schema_migrations (name) VALUES ('0001_init.sql')`,
	); err != nil {
		t.Fatalf("mark 0001 applied: %v", err)
	}
	if err := runMigrationSQL(ctx, pool, "fake_bad.sql", `BAD SQL HERE`); err == nil {
		t.Fatal("expected runMigrationSQL to fail on bad SQL")
	}
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM admin_panel.schema_migrations WHERE name = 'fake_bad.sql'`,
	).Scan(&count); err != nil {
		t.Fatalf("query: %v", err)
	}
	if count != 0 {
		t.Fatal("expected failed migration NOT to be recorded in schema_migrations (rollback)")
	}
}
