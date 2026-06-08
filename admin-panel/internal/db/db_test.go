package db

import (
	"context"
	"testing"
)

func TestConnectRejectsBadDSN(t *testing.T) {
	if _, err := Connect(context.Background(), "not://a-valid-dsn"); err == nil {
		t.Fatal("expected error for invalid DSN")
	}
}

func TestConnectUnreachable(t *testing.T) {
	_, err := Connect(context.Background(), "postgres://nope@127.0.0.1:1/none?sslmode=disable&connect_timeout=1")
	if err == nil {
		t.Fatal("expected error connecting to an unreachable database")
	}
}
