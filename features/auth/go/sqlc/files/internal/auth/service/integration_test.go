package authservice

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"

	_ "github.com/lib/pq"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/uuid"
)

func requireDB(t *testing.T) *sql.DB {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping DB integration test in short mode")
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Ping(); err != nil {
		t.Skip("postgres unreachable: " + err.Error())
	}
	return db
}

func TestFullSignupLoginRefreshReplay(t *testing.T) {
	db := requireDB(t)
	t.Cleanup(func() { _ = db.Close() })

	ctx := context.Background()
	q := NewSQLQuerier(db)
	secrets := newTestSecrets(t)
	svc := New(q, secrets)

	email := "test+" + uuid.V4()[:8] + "@example.com"
	hash, err := HashPassword("Sup3rSecret!")
	if err != nil {
		t.Fatal(err)
	}
	user, err := q.CreateUser(ctx, CreateUserParams{
		ID: uuid.V4(), Email: email, PasswordHash: hash, Role: "user",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), "DELETE FROM auth_users WHERE id = $1", user.ID)
	})

	s1, err := svc.IssueSession(ctx, IssueSessionInput{User: user})
	if err != nil {
		t.Fatal(err)
	}
	s2, err := svc.Refresh(ctx, s1.Tokens.RefreshToken, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Refresh(ctx, s1.Tokens.RefreshToken, "", ""); err == nil {
		t.Fatal("expected replay error")
	} else {
		var ae apperr.AppError
		if !errors.As(err, &ae) || ae.Detail != "token_replay_detected" {
			t.Fatalf("expected token_replay_detected, got %v", err)
		}
	}
	sess2, err := q.GetSessionByID(ctx, s2.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if !sess2.RevokedAt.Valid {
		t.Fatal("descendant must be revoked on replay")
	}
}
