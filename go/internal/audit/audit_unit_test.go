package audit

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"projx.local/go/internal/auth"
)

func mockAuditor(t *testing.T) (*Auditor, sqlmock.Sqlmock, *sql.DB) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	require.NoError(t, err)
	gdb, err := gorm.Open(postgres.New(postgres.Config{
		Conn:                 sqlDB,
		PreferSimpleProtocol: true,
	}), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	return New(gdb), mock, sqlDB
}

type sample struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

func TestSkippedCoversAuditAndPlumbing(t *testing.T) {
	assert.True(t, Skipped("audit_logs"))
	assert.True(t, Skipped("service_configs"))
	assert.False(t, Skipped("posts"))
}

func TestActorFromContext(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := auth.WithUser(req.Context(), &auth.AuthUser{Email: "alice@example.com", ID: "u-1"})
	assert.Equal(t, "alice@example.com", Actor(req.WithContext(ctx)))
}

func TestActorFallsBackToIDWhenNoEmail(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := auth.WithUser(req.Context(), &auth.AuthUser{ID: "u-2"})
	assert.Equal(t, "u-2", Actor(req.WithContext(ctx)))
}

func TestActorSystemWhenUnauthenticated(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	assert.Equal(t, SystemActor, Actor(req))
	assert.Equal(t, SystemActor, Actor(nil))
}

func TestIDOfReadsStringID(t *testing.T) {
	assert.Equal(t, "abc", idOf(&sample{ID: "abc"}))
	assert.Equal(t, "abc", idOf(sample{ID: "abc"}))
	assert.Equal(t, "", idOf(nil))
	assert.Equal(t, "", idOf((*sample)(nil)))
	assert.Equal(t, "", idOf("not-a-struct"))
}

func TestAsJSONRoundTrips(t *testing.T) {
	out := asJSON(&sample{ID: "x", Title: "hello"})
	require.NotNil(t, out)
	assert.Equal(t, "x", out["id"])
	assert.Equal(t, "hello", out["title"])
	assert.Nil(t, asJSON(nil))
}

func TestJSONValueScan(t *testing.T) {
	var j JSON
	v, err := j.Value()
	require.NoError(t, err)
	assert.Nil(t, v)

	j = JSON{"a": float64(1)}
	v, err = j.Value()
	require.NoError(t, err)
	assert.Equal(t, []byte(`{"a":1}`), v.([]byte))

	var back JSON
	require.NoError(t, back.Scan([]byte(`{"a":1}`)))
	assert.Equal(t, float64(1), back["a"])
	require.NoError(t, back.Scan(`{"b":2}`))
	assert.Equal(t, float64(2), back["b"])
	require.NoError(t, back.Scan(nil))
	assert.Nil(t, back)
	require.Error(t, back.Scan(123))
}

func TestBeforeCreateAssignsDefaults(t *testing.T) {
	a := &AuditLog{}
	require.NoError(t, a.BeforeCreate(nil))
	assert.NotEmpty(t, a.ID)
	assert.Equal(t, SystemActor, a.PerformedBy)

	preset := &AuditLog{ID: "fixed", PerformedBy: "bob"}
	require.NoError(t, preset.BeforeCreate(nil))
	assert.Equal(t, "fixed", preset.ID)
	assert.Equal(t, "bob", preset.PerformedBy)
}

func TestTableName(t *testing.T) {
	assert.Equal(t, "audit_logs", AuditLog{}.TableName())
}

func TestNilAuditorIsNoop(t *testing.T) {
	var a *Auditor
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	a.RecordInsert(req, "posts", &sample{ID: "1"})
	a.RecordUpdate(req, "posts", &sample{ID: "1"}, &sample{ID: "1"})
	a.RecordDelete(req, "posts", &sample{ID: "1"})
}

func TestAuditorSkipsSkippedTable(t *testing.T) {
	a := New(nil)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	a.RecordInsert(req, "audit_logs", &sample{ID: "1"})
	a.RecordUpdate(req, "service_configs", &sample{ID: "1"}, &sample{ID: "1"})
	a.RecordDelete(req, "audit_logs", &sample{ID: "1"})
}

func TestContextOfDefaults(t *testing.T) {
	assert.Equal(t, context.Background(), contextOf(nil))
}

func TestWriteFailureIsBestEffort(t *testing.T) {
	a, mock, sqlDB := mockAuditor(t)
	defer sqlDB.Close()

	mock.ExpectQuery(`INSERT INTO "audit_logs"`).WillReturnError(errors.New("db down"))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	assert.NotPanics(t, func() {
		a.RecordInsert(req, "posts", &sample{ID: "1", Title: "x"})
	})
}

func TestRecordInsertWritesPerRecord(t *testing.T) {
	a, mock, sqlDB := mockAuditor(t)
	defer sqlDB.Close()

	for _, id := range []string{"a", "b"} {
		mock.ExpectQuery(`INSERT INTO "audit_logs"`).
			WithArgs(sqlmock.AnyArg(), "posts", id, "INSERT",
				sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
				sqlmock.AnyArg(), sqlmock.AnyArg()).
			WillReturnRows(sqlmock.NewRows([]string{"performed_at"}).AddRow(time.Now()))
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	a.RecordInsert(req, "posts", &sample{ID: "a"}, &sample{ID: "b"})
	require.NoError(t, mock.ExpectationsWereMet())
}
