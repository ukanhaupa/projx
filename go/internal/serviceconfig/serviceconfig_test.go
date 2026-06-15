package serviceconfig

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"projx.local/go/internal/apperr"
)

func newMockGormDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, *sql.DB) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	gormDB, err := gorm.Open(postgres.New(postgres.Config{
		Conn:                 sqlDB,
		PreferSimpleProtocol: true,
	}), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	return gormDB, mock, sqlDB
}

func newTestService(t *testing.T, gdb *gorm.DB) *Service {
	t.Helper()
	return &Service{
		db:    gdb,
		key:   testKey,
		ttl:   10 * time.Minute,
		cache: map[string]cacheEntry{},
		now:   time.Now,
	}
}

func TestNewServiceRequiresKey(t *testing.T) {
	t.Setenv("CRED_ENCRYPTION_KEY", "")
	_, err := NewService(nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "CRED_ENCRYPTION_KEY")
}

func TestNewServiceRejectsBadBase64(t *testing.T) {
	t.Setenv("CRED_ENCRYPTION_KEY", "!!!not-base64!!!")
	_, err := NewService(nil)
	require.Error(t, err)
}

func TestNewServiceRejectsWrongKeyLength(t *testing.T) {
	t.Setenv("CRED_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString([]byte("too-short")))
	_, err := NewService(nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "32 bytes")
}

func TestNewServiceLoadsKeyAndDefaultsTTL(t *testing.T) {
	t.Setenv("CRED_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(testKey))
	t.Setenv("CONFIG_CACHE_TTL_SECONDS", "")
	gdb, _, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()

	svc, err := NewService(gdb)
	require.NoError(t, err)
	assert.Equal(t, 600*time.Second, svc.ttl)
	assert.Len(t, svc.key, 32)
}

func TestNewServiceHonorsCacheTTLOverride(t *testing.T) {
	t.Setenv("CRED_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(testKey))
	t.Setenv("CONFIG_CACHE_TTL_SECONDS", "5")
	gdb, _, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()

	svc, err := NewService(gdb)
	require.NoError(t, err)
	assert.Equal(t, 5*time.Second, svc.ttl)
}

func TestGetReturnsNotFoundWhenAbsent(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	mock.ExpectQuery(`SELECT \* FROM "service_configs"`).
		WithArgs("smtp", true, 1).
		WillReturnError(gorm.ErrRecordNotFound)

	_, err := svc.Get(context.Background(), "smtp")
	require.Error(t, err)
	var ae apperr.AppError
	require.True(t, errors.As(err, &ae))
	assert.Equal(t, "not_found", ae.Code)
}

func TestGetDecryptsAndCaches(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	encrypted, err := encrypt(testKey, `{"host":"mail.example"}`)
	require.NoError(t, err)

	rows := sqlmock.NewRows([]string{"id", "purpose", "config", "is_active", "created_at", "updated_at"}).
		AddRow("id-1", "smtp", encrypted, true, time.Now(), time.Now())
	mock.ExpectQuery(`SELECT \* FROM "service_configs"`).
		WithArgs("smtp", true, 1).
		WillReturnRows(rows)

	got, err := svc.Get(context.Background(), "smtp")
	require.NoError(t, err)
	assert.Equal(t, `{"host":"mail.example"}`, got)

	got2, err := svc.Get(context.Background(), "smtp")
	require.NoError(t, err)
	assert.Equal(t, got, got2)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGetCacheTTLExpiry(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()

	current := time.Now()
	svc := &Service{
		db:    gdb,
		key:   testKey,
		ttl:   60 * time.Second,
		cache: map[string]cacheEntry{},
		now:   func() time.Time { return current },
	}

	encrypted, err := encrypt(testKey, "value-v1")
	require.NoError(t, err)
	encrypted2, err := encrypt(testKey, "value-v2")
	require.NoError(t, err)

	mock.ExpectQuery(`SELECT \* FROM "service_configs"`).
		WithArgs("k", true, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "purpose", "config", "is_active", "created_at", "updated_at"}).
			AddRow("id-1", "k", encrypted, true, time.Now(), time.Now()))
	mock.ExpectQuery(`SELECT \* FROM "service_configs"`).
		WithArgs("k", true, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "purpose", "config", "is_active", "created_at", "updated_at"}).
			AddRow("id-1", "k", encrypted2, true, time.Now(), time.Now()))

	v1, err := svc.Get(context.Background(), "k")
	require.NoError(t, err)
	assert.Equal(t, "value-v1", v1)

	current = current.Add(30 * time.Second)
	cached, err := svc.Get(context.Background(), "k")
	require.NoError(t, err)
	assert.Equal(t, "value-v1", cached)

	current = current.Add(31 * time.Second)
	v2, err := svc.Get(context.Background(), "k")
	require.NoError(t, err)
	assert.Equal(t, "value-v2", v2)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGetDBErrorBubblesUp(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	mock.ExpectQuery(`SELECT \* FROM "service_configs"`).
		WithArgs("smtp", true, 1).
		WillReturnError(errors.New("conn reset"))

	_, err := svc.Get(context.Background(), "smtp")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "conn reset")
}

func TestGetReturnsErrorWhenCiphertextCorrupt(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	rows := sqlmock.NewRows([]string{"id", "purpose", "config", "is_active", "created_at", "updated_at"}).
		AddRow("id-1", "smtp", "not-valid-base64-!!!", true, time.Now(), time.Now())
	mock.ExpectQuery(`SELECT \* FROM "service_configs"`).
		WithArgs("smtp", true, 1).
		WillReturnRows(rows)

	_, err := svc.Get(context.Background(), "smtp")
	require.Error(t, err)
}

func TestSetCreatesRowWhenAbsent(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	mock.ExpectQuery(`SELECT \* FROM "service_configs"`).
		WithArgs("smtp", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO "service_configs"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	require.NoError(t, svc.Set(context.Background(), "smtp", `{"host":"mail"}`))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSetUpdatesRowWhenPresent(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	rows := sqlmock.NewRows([]string{"id", "purpose", "config", "is_active", "created_at", "updated_at"}).
		AddRow("id-1", "smtp", "old", false, time.Now(), time.Now())
	mock.ExpectQuery(`SELECT \* FROM "service_configs"`).
		WithArgs("smtp", 1).
		WillReturnRows(rows)

	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE "service_configs"`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	require.NoError(t, svc.Set(context.Background(), "smtp", `{"host":"new"}`))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSetInvalidatesCache(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	svc.mu.Lock()
	svc.cache["smtp"] = cacheEntry{value: "stale", expiresAt: time.Now().Add(time.Hour)}
	svc.mu.Unlock()

	mock.ExpectQuery(`SELECT \* FROM "service_configs"`).
		WithArgs("smtp", 1).
		WillReturnError(gorm.ErrRecordNotFound)
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO "service_configs"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	require.NoError(t, svc.Set(context.Background(), "smtp", `{"x":1}`))
	svc.mu.RLock()
	_, ok := svc.cache["smtp"]
	svc.mu.RUnlock()
	assert.False(t, ok)
}

func TestSetSurfacesDBError(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	mock.ExpectQuery(`SELECT \* FROM "service_configs"`).
		WithArgs("smtp", 1).
		WillReturnError(errors.New("db down"))

	err := svc.Set(context.Background(), "smtp", `{"x":1}`)
	require.Error(t, err)
}

func TestDeleteRemovesRow(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	svc.mu.Lock()
	svc.cache["smtp"] = cacheEntry{value: "v", expiresAt: time.Now().Add(time.Hour)}
	svc.mu.Unlock()

	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM "service_configs"`).
		WithArgs("smtp").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	require.NoError(t, svc.Delete(context.Background(), "smtp"))
	svc.mu.RLock()
	_, ok := svc.cache["smtp"]
	svc.mu.RUnlock()
	assert.False(t, ok)
}

func TestDeleteReturnsNotFoundWhenAbsent(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM "service_configs"`).
		WithArgs("smtp").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	err := svc.Delete(context.Background(), "smtp")
	require.Error(t, err)
	var ae apperr.AppError
	require.True(t, errors.As(err, &ae))
	assert.Equal(t, "not_found", ae.Code)
}

func TestDeleteSurfacesDBError(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM "service_configs"`).
		WithArgs("smtp").
		WillReturnError(errors.New("conn refused"))
	mock.ExpectRollback()

	err := svc.Delete(context.Background(), "smtp")
	require.Error(t, err)
}

func TestInvalidateClearsSpecificKey(t *testing.T) {
	gdb, _, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	svc.mu.Lock()
	svc.cache["a"] = cacheEntry{value: "va", expiresAt: time.Now().Add(time.Hour)}
	svc.cache["b"] = cacheEntry{value: "vb", expiresAt: time.Now().Add(time.Hour)}
	svc.mu.Unlock()

	svc.Invalidate("a")
	svc.mu.RLock()
	_, hasA := svc.cache["a"]
	_, hasB := svc.cache["b"]
	svc.mu.RUnlock()
	assert.False(t, hasA)
	assert.True(t, hasB)
}

func TestInvalidateAllClearsEverything(t *testing.T) {
	gdb, _, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	svc.mu.Lock()
	svc.cache["a"] = cacheEntry{value: "va", expiresAt: time.Now().Add(time.Hour)}
	svc.cache["b"] = cacheEntry{value: "vb", expiresAt: time.Now().Add(time.Hour)}
	svc.mu.Unlock()

	svc.InvalidateAll()
	svc.mu.RLock()
	n := len(svc.cache)
	svc.mu.RUnlock()
	assert.Equal(t, 0, n)
}

func TestGetConfigUnmarshalsJSON(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	encrypted, err := encrypt(testKey, `{"host":"mail.example","port":587}`)
	require.NoError(t, err)
	rows := sqlmock.NewRows([]string{"id", "purpose", "config", "is_active", "created_at", "updated_at"}).
		AddRow("id-1", "smtp", encrypted, true, time.Now(), time.Now())
	mock.ExpectQuery(`SELECT \* FROM "service_configs"`).
		WithArgs("smtp", true, 1).
		WillReturnRows(rows)

	got, err := svc.GetConfig(context.Background(), "smtp")
	require.NoError(t, err)
	assert.Equal(t, "mail.example", got["host"])
	assert.EqualValues(t, 587, got["port"])
}

func TestGetConfigRejectsNonJSONPayload(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	encrypted, err := encrypt(testKey, `not-json`)
	require.NoError(t, err)
	rows := sqlmock.NewRows([]string{"id", "purpose", "config", "is_active", "created_at", "updated_at"}).
		AddRow("id-1", "smtp", encrypted, true, time.Now(), time.Now())
	mock.ExpectQuery(`SELECT \* FROM "service_configs"`).
		WithArgs("smtp", true, 1).
		WillReturnRows(rows)

	_, err = svc.GetConfig(context.Background(), "smtp")
	require.Error(t, err)
}

func TestSetConfigMarshalsAndEncrypts(t *testing.T) {
	gdb, mock, sqlDB := newMockGormDB(t)
	defer sqlDB.Close()
	svc := newTestService(t, gdb)

	mock.ExpectQuery(`SELECT \* FROM "service_configs"`).
		WithArgs("smtp", 1).
		WillReturnError(gorm.ErrRecordNotFound)
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO "service_configs"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	require.NoError(t, svc.SetConfig(context.Background(), "smtp", map[string]any{"host": "mail.example"}))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestModelTableName(t *testing.T) {
	assert.Equal(t, "service_configs", ServiceConfig{}.TableName())
}

func TestModelBeforeCreateAssignsID(t *testing.T) {
	s := &ServiceConfig{}
	require.NoError(t, s.BeforeCreate(nil))
	assert.Len(t, s.ID, 36)
}

func TestModelBeforeCreatePreservesID(t *testing.T) {
	s := &ServiceConfig{ID: "preset"}
	require.NoError(t, s.BeforeCreate(nil))
	assert.Equal(t, "preset", s.ID)
}
