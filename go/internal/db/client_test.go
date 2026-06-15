package db

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOpenRequiresDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	gdb, err := Open(context.Background())
	require.Error(t, err)
	assert.Nil(t, gdb)
	assert.Contains(t, err.Error(), "DATABASE_URL")
}

func TestOpenUnreachableDSN(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://invalid:invalid@127.0.0.1:1/doesnotexist?sslmode=disable&connect_timeout=1")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	gdb, err := Open(ctx)
	require.Error(t, err)
	assert.Nil(t, gdb)
}

func TestMustOpenPanicsOnError(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	assert.Panics(t, func() {
		_ = MustOpen(context.Background())
	})
}

func TestMustOpenPanicsOnUnreachableDSN(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://invalid:invalid@127.0.0.1:1/doesnotexist?sslmode=disable&connect_timeout=1")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	assert.Panics(t, func() {
		_ = MustOpen(ctx)
	})
}

func TestOpenMalformedDSN(t *testing.T) {
	t.Setenv("DATABASE_URL", "://not-a-real-dsn")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	gdb, err := Open(ctx)
	require.Error(t, err)
	assert.Nil(t, gdb)
}
