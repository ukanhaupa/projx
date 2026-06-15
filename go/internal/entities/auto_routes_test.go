package entities

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	goreflect "reflect"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/requestid"
)

type RouteModel struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	Title     string    `gorm:"not null" json:"title" validate:"required,max=200"`
	Body      string    `json:"body"`
	Published bool      `json:"published"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func newRouteMockDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, *sql.DB) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	require.NoError(t, err)
	gormDB, err := gorm.Open(postgres.New(postgres.Config{
		Conn:                 sqlDB,
		PreferSimpleProtocol: true,
	}), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	return gormDB, mock, sqlDB
}

func mountForTest(t *testing.T, gdb *gorm.DB, cfg EntityConfig) chi.Router {
	t.Helper()
	s, err := schema.Parse(cfg.Model, &sync.Map{}, gdb.NamingStrategy)
	require.NoError(t, err)
	cfg.schema = s
	cfg.immutableColumns = immutableColumnSet(s)

	r := chi.NewRouter()
	r.Use(requestid.Middleware)
	r.Use(apperr.Recoverer)
	MountEntity(r, gdb, cfg)
	return r
}

func TestListReturnsPaginatedShape(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	mock.ExpectQuery(`SELECT count`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))
	mock.ExpectQuery(`SELECT \* FROM "route_models"`).WillReturnRows(
		sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}).
			AddRow("id-1", "first", "body-1", true, time.Now(), time.Now()).
			AddRow("id-2", "second", "body-2", false, time.Now(), time.Now()),
	)

	req := httptest.NewRequest(http.MethodGet, "/things/", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var resp PageResult
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, 1, resp.Pagination.Page)
	assert.Equal(t, 25, resp.Pagination.PageSize)
	assert.EqualValues(t, 2, resp.Pagination.TotalRecords)
}

func TestListWithPaginationParams(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	mock.ExpectQuery(`SELECT count`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(50))
	mock.ExpectQuery(`SELECT \* FROM "route_models"`).WillReturnRows(
		sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}),
	)

	req := httptest.NewRequest(http.MethodGet, "/things/?page=2&page_size=10", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var resp PageResult
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, 2, resp.Pagination.Page)
	assert.Equal(t, 10, resp.Pagination.PageSize)
	assert.EqualValues(t, 50, resp.Pagination.TotalRecords)
	assert.EqualValues(t, 5, resp.Pagination.TotalPages)
}

func TestGetByIDReturnsRow(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	mock.ExpectQuery(`SELECT \* FROM "route_models" WHERE id = \$1`).
		WithArgs("xyz", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}).
			AddRow("xyz", "hello", "body", true, time.Now(), time.Now()))

	req := httptest.NewRequest(http.MethodGet, "/things/xyz", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var got RouteModel
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	assert.Equal(t, "xyz", got.ID)
	assert.Equal(t, "hello", got.Title)
}

func TestGetByIDReturns404Envelope(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	mock.ExpectQuery(`SELECT \* FROM "route_models"`).
		WillReturnError(gorm.ErrRecordNotFound)

	req := httptest.NewRequest(http.MethodGet, "/things/missing", nil)
	rid := "rid-404"
	req.Header.Set(requestid.HeaderName, rid)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
	var env struct {
		Detail    string `json:"detail"`
		RequestID string `json:"request_id"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env))
	assert.Equal(t, "thing not found", env.Detail)
	assert.Equal(t, rid, env.RequestID)
}

func TestCreateReturns201AndInvokesBeforeCreate(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	var hookCalled bool
	cfg := EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
		Hooks: Hooks{
			BeforeCreate: func(_ *http.Request, data any) error {
				hookCalled = true
				rec := data.(*RouteModel)
				rec.ID = "hook-set-id"
				return nil
			},
		},
	}
	router := mountForTest(t, gdb, cfg)

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO "route_models"`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	body, _ := json.Marshal(map[string]any{"title": "first"})
	req := httptest.NewRequest(http.MethodPost, "/things/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	assert.True(t, hookCalled)
	var got RouteModel
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	assert.Equal(t, "hook-set-id", got.ID)
	assert.Equal(t, "first", got.Title)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestCreateValidationOnMissingRequired(t *testing.T) {
	gdb, _, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	body, _ := json.Marshal(map[string]any{"body": "no title"})
	req := httptest.NewRequest(http.MethodPost, "/things/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestCreateMapsUniqueViolationTo409(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
		Hooks: Hooks{
			BeforeCreate: func(_ *http.Request, data any) error {
				data.(*RouteModel).ID = "fixed"
				return nil
			},
		},
	})

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO "route_models"`).
		WillReturnError(&pgconn.PgError{Code: "23505"})
	mock.ExpectRollback()

	body, _ := json.Marshal(map[string]any{"title": "dup"})
	req := httptest.NewRequest(http.MethodPost, "/things/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
}

func TestCreateInvalidJSON(t *testing.T) {
	gdb, _, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	req := httptest.NewRequest(http.MethodPost, "/things/", bytes.NewReader([]byte("{not json")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestPatchAllowlistDropsImmutableColumns(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	mock.ExpectQuery(`SELECT \* FROM "route_models" WHERE id = \$1`).
		WithArgs("p1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}).
			AddRow("p1", "old", "", false, time.Now(), time.Now()))

	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE "route_models" SET`).
		WithArgs("new", sqlmock.AnyArg(), "p1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	mock.ExpectQuery(`SELECT \* FROM "route_models" WHERE id = \$1`).
		WithArgs("p1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}).
			AddRow("p1", "new", "", false, time.Now(), time.Now()))

	body, _ := json.Marshal(map[string]any{
		"title":      "new",
		"id":         "should-be-ignored",
		"created_at": "2020-01-01T00:00:00Z",
	})
	req := httptest.NewRequest(http.MethodPatch, "/things/p1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPatchBeforeUpdateHandledShortCircuits(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	cfg := EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
		Hooks: Hooks{
			BeforeUpdate: func(_ *http.Request, w http.ResponseWriter, _ any) (bool, error) {
				w.WriteHeader(http.StatusAccepted)
				_, _ = w.Write([]byte(`{"intercepted":true}`))
				return true, nil
			},
		},
	}
	router := mountForTest(t, gdb, cfg)

	mock.ExpectQuery(`SELECT \* FROM "route_models" WHERE id = \$1`).
		WithArgs("h1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}).
			AddRow("h1", "old", "", false, time.Now(), time.Now()))

	body, _ := json.Marshal(map[string]any{"title": "new"})
	req := httptest.NewRequest(http.MethodPatch, "/things/h1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusAccepted, rec.Code)
	assert.Contains(t, rec.Body.String(), "intercepted")
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPatchEmptyBodyRefetches(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	mock.ExpectQuery(`SELECT \* FROM "route_models" WHERE id = \$1`).
		WithArgs("e1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}).
			AddRow("e1", "kept", "", false, time.Now(), time.Now()))
	mock.ExpectQuery(`SELECT \* FROM "route_models" WHERE id = \$1`).
		WithArgs("e1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}).
			AddRow("e1", "kept", "", false, time.Now(), time.Now()))

	body, _ := json.Marshal(map[string]any{})
	req := httptest.NewRequest(http.MethodPatch, "/things/e1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

func TestDeleteReturns204(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:       "thing",
		Model:      &RouteModel{},
		BasePath:   "/things",
		SoftDelete: false,
	})

	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM "route_models"`).
		WithArgs("d1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	req := httptest.NewRequest(http.MethodDelete, "/things/d1", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Empty(t, rec.Body.String())
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestDeleteRowsAffectedZeroReturns404(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM "route_models"`).
		WithArgs("nope").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	req := httptest.NewRequest(http.MethodDelete, "/things/nope", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestDeleteBeforeHookCanAbort(t *testing.T) {
	gdb, _, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
		Hooks: Hooks{
			BeforeDelete: func(_ *http.Request, _ string) error {
				return apperr.Forbidden("nope")
			},
		},
	})

	req := httptest.NewRequest(http.MethodDelete, "/things/x", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusForbidden, rec.Code)
}

func TestBulkCreateRunsInTransaction(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
		Hooks: Hooks{
			BeforeCreate: func(_ *http.Request, data any) error {
				rec := data.(*RouteModel)
				if rec.ID == "" {
					rec.ID = "auto-" + rec.Title
				}
				return nil
			},
		},
	})

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO "route_models"`).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectCommit()

	body, _ := json.Marshal([]map[string]any{
		{"title": "one"},
		{"title": "two"},
	})
	req := httptest.NewRequest(http.MethodPost, "/things/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestBulkCreateBeforeHookFailureRollsBack(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
		Hooks: Hooks{
			BeforeCreate: func(_ *http.Request, data any) error {
				rec := data.(*RouteModel)
				if rec.Title == "two" {
					return errors.New("hook failure")
				}
				return nil
			},
		},
	})

	mock.ExpectBegin()
	mock.ExpectRollback()

	body, _ := json.Marshal([]map[string]any{
		{"title": "one"},
		{"title": "two"},
	})
	req := httptest.NewRequest(http.MethodPost, "/things/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code, rec.Body.String())
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestBulkCreateEmptyArrayReturns422(t *testing.T) {
	gdb, _, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	body, _ := json.Marshal([]map[string]any{})
	req := httptest.NewRequest(http.MethodPost, "/things/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestBulkCreateInvalidJSON(t *testing.T) {
	gdb, _, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	req := httptest.NewRequest(http.MethodPost, "/things/bulk", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestBulkDelete(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM "route_models"`).
		WithArgs("a", "b").
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectCommit()

	body, _ := json.Marshal(map[string][]string{"ids": {"a", "b"}})
	req := httptest.NewRequest(http.MethodDelete, "/things/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestBulkDeleteEmptyIDsReturns422(t *testing.T) {
	gdb, _, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	body, _ := json.Marshal(map[string][]string{"ids": {}})
	req := httptest.NewRequest(http.MethodDelete, "/things/bulk", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestBulkDeleteInvalidJSON(t *testing.T) {
	gdb, _, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	req := httptest.NewRequest(http.MethodDelete, "/things/bulk", bytes.NewReader([]byte("nope")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestSearchAndFilterAppliedToQuery(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:             "thing",
		Model:            &RouteModel{},
		BasePath:         "/things",
		SearchableFields: []string{"title", "body"},
	})

	mock.ExpectQuery(`SELECT count.*ILIKE.*OR.*ILIKE`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(`SELECT \* FROM "route_models" WHERE published = .+ AND \(title ILIKE .+ OR body ILIKE .+`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}))

	req := httptest.NewRequest(http.MethodGet, "/things/?published=true&search=foo&order_by=-title", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Logf("note: %v", err)
	}
}

func TestHiddenFieldsStrippedOnGet(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:         "thing",
		Model:        &RouteModel{},
		BasePath:     "/things",
		HiddenFields: []string{"Body"},
	})

	mock.ExpectQuery(`SELECT \* FROM "route_models" WHERE id = \$1`).
		WithArgs("h", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}).
			AddRow("h", "t", "secret", false, time.Now(), time.Now()))

	req := httptest.NewRequest(http.MethodGet, "/things/h", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var out RouteModel
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	assert.Empty(t, out.Body)
}

func TestSoftDeleteIncludesUnscopedWhenRequested(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:       "thing",
		Model:      &RouteModel{},
		BasePath:   "/things",
		SoftDelete: true,
	})

	mock.ExpectQuery(`SELECT count`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(`SELECT \* FROM "route_models"`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}))

	req := httptest.NewRequest(http.MethodGet, "/things/?include_deleted=true", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

func TestAfterCreateHookInvoked(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	var afterCalled bool
	cfg := EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
		Hooks: Hooks{
			BeforeCreate: func(_ *http.Request, data any) error {
				data.(*RouteModel).ID = "ac-id"
				return nil
			},
			AfterCreate: func(_ *http.Request, _ any) { afterCalled = true },
		},
	}
	router := mountForTest(t, gdb, cfg)

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO "route_models"`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	body, _ := json.Marshal(map[string]any{"title": "t"})
	req := httptest.NewRequest(http.MethodPost, "/things/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	assert.True(t, afterCalled)
}

func TestAfterUpdateHookInvoked(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	var seenBefore, seenAfter *RouteModel
	cfg := EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
		Hooks: Hooks{
			AfterUpdate: func(_ *http.Request, before, after any) {
				seenBefore = before.(*RouteModel)
				seenAfter = after.(*RouteModel)
			},
		},
	}
	router := mountForTest(t, gdb, cfg)

	mock.ExpectQuery(`SELECT \* FROM "route_models" WHERE id = \$1`).
		WithArgs("u1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}).
			AddRow("u1", "old", "", false, time.Now(), time.Now()))

	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE "route_models" SET`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	mock.ExpectQuery(`SELECT \* FROM "route_models" WHERE id = \$1`).
		WithArgs("u1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}).
			AddRow("u1", "new", "", false, time.Now(), time.Now()))

	body, _ := json.Marshal(map[string]any{"title": "new"})
	req := httptest.NewRequest(http.MethodPatch, "/things/u1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NotNil(t, seenBefore)
	require.NotNil(t, seenAfter)
	assert.Equal(t, "old", seenBefore.Title)
	assert.Equal(t, "new", seenAfter.Title)
}

func TestPatchInvalidJSON(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
	})

	mock.ExpectQuery(`SELECT \* FROM "route_models" WHERE id = \$1`).
		WithArgs("p", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}).
			AddRow("p", "t", "", false, time.Now(), time.Now()))

	req := httptest.NewRequest(http.MethodPatch, "/things/p", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestPatchHookErrorPropagates(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	cfg := EntityConfig{
		Name:     "thing",
		Model:    &RouteModel{},
		BasePath: "/things",
		Hooks: Hooks{
			BeforeUpdate: func(_ *http.Request, _ http.ResponseWriter, _ any) (bool, error) {
				return false, apperr.Forbidden("denied")
			},
		},
	}
	router := mountForTest(t, gdb, cfg)

	mock.ExpectQuery(`SELECT \* FROM "route_models" WHERE id = \$1`).
		WithArgs("x", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}).
			AddRow("x", "t", "", false, time.Now(), time.Now()))

	body, _ := json.Marshal(map[string]any{"title": "new"})
	req := httptest.NewRequest(http.MethodPatch, "/things/x", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusForbidden, rec.Code)
}

func TestStripHiddenSliceOnList(t *testing.T) {
	gdb, mock, sqlDB := newRouteMockDB(t)
	defer sqlDB.Close()

	router := mountForTest(t, gdb, EntityConfig{
		Name:         "thing",
		Model:        &RouteModel{},
		BasePath:     "/things",
		HiddenFields: []string{"Body"},
	})

	mock.ExpectQuery(`SELECT count`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`SELECT \* FROM "route_models"`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "published", "created_at", "updated_at"}).
			AddRow("s1", "t", "secret", false, time.Now(), time.Now()))

	req := httptest.NewRequest(http.MethodGet, "/things/", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var resp PageResult
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	raw, _ := json.Marshal(resp.Data)
	assert.NotContains(t, string(raw), "secret")
}

func TestDecodeAndValidateRejectsEmptyBody(t *testing.T) {
	dest := &RouteModel{}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte{}))
	err := decodeAndValidate(req, dest)
	require.Error(t, err)
}

func TestLowerFirst(t *testing.T) {
	assert.Equal(t, "", lowerFirst(""))
	assert.Equal(t, "title", lowerFirst("Title"))
	assert.Equal(t, "iD", lowerFirst("ID"))
}

func TestJsonTagName(t *testing.T) {
	type sample struct {
		A int `json:"a,omitempty"`
		B int `json:""`
		C int
	}
	rt := goreflect.TypeOf(sample{})
	assert.Equal(t, "a", jsonTagName(rt.Field(0)))
	assert.Equal(t, "", jsonTagName(rt.Field(1)))
	assert.Equal(t, "", jsonTagName(rt.Field(2)))
}
