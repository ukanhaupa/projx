package authservice

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"

	"projx.local/go/internal/apperr"
)

func newMockQuerier(t *testing.T) (*sqlQuerier, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	return &sqlQuerier{db: db}, mock, func() { _ = db.Close() }
}

func TestGetUserByEmailNotFound(t *testing.T) {
	q, mock, done := newMockQuerier(t)
	defer done()
	mock.ExpectQuery("SELECT (.+) FROM auth_users").WithArgs("missing@x").WillReturnError(sql.ErrNoRows)
	_, err := q.GetUserByEmail(context.Background(), "missing@x")
	var ae apperr.AppError
	if !errors.As(err, &ae) || ae.Status != 404 {
		t.Fatalf("expected NotFound, got %v", err)
	}
}

func TestCreateSession(t *testing.T) {
	q, mock, done := newMockQuerier(t)
	defer done()
	mock.ExpectQuery("INSERT INTO auth_sessions").
		WithArgs("sid", "uid", "hash", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "user_id", "refresh_token_hash", "parent_session_id", "ip_address", "user_agent", "revoked_at", "expires_at", "created_at",
		}).AddRow("sid", "uid", "hash", nil, nil, nil, nil, time.Now(), time.Now()))
	got, err := q.CreateSession(context.Background(), CreateSessionParams{
		ID: "sid", UserID: "uid", RefreshTokenHash: "hash", ExpiresAt: time.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "sid" {
		t.Fatal("unexpected id")
	}
}
