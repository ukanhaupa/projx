package sync

import (
	"database/sql"
	"encoding/json"
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

	"projx.local/go/internal/entities"
)

type widget struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	Name      string    `gorm:"not null;uniqueIndex" json:"name" validate:"required"`
	Secret    string    `json:"secret"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
}

func newMockDB(t *testing.T) (*gorm.DB, *sql.DB) {
	t.Helper()
	sqlDB, _, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	require.NoError(t, err)
	gormDB, err := gorm.Open(postgres.New(postgres.Config{
		Conn:                 sqlDB,
		PreferSimpleProtocol: true,
	}), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	return gormDB, sqlDB
}

func TestBuildReturnsEntitySchema(t *testing.T) {
	gdb, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	cfg := entities.EntityConfig{
		Name:             "widget",
		Model:            &widget{},
		BasePath:         "/widgets",
		SearchableFields: []string{"name"},
		HiddenFields:     []string{"Secret"},
		SoftDelete:       true,
	}

	resp, err := Build(gdb, []entities.EntityConfig{cfg})
	require.NoError(t, err)
	require.Contains(t, resp.Entities, "widget")

	es := resp.Entities["widget"]
	assert.Equal(t, "/widgets", es.BasePath)
	assert.Equal(t, "/api/v1/widgets", es.APIPath)
	assert.Equal(t, "widgets", es.TableName)
	assert.True(t, es.SoftDelete)
	assert.Equal(t, []string{"name"}, es.SearchableFields)
	assert.Equal(t, []string{"Secret"}, es.HiddenFields)

	byName := map[string]FieldSchema{}
	for _, f := range es.Fields {
		byName[f.Name] = f
	}
	assert.NotContains(t, byName, "Secret", "hidden field must be excluded")
	require.Contains(t, byName, "ID")
	assert.True(t, byName["ID"].PrimaryKey)
	assert.Equal(t, "id", byName["ID"].JSONName)
	require.Contains(t, byName, "Name")
	assert.False(t, byName["Name"].Nullable)
	assert.Equal(t, "name", byName["Name"].JSONName)
}

func TestRoutesEmitsJSON(t *testing.T) {
	gdb, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	entities.Reset()
	t.Cleanup(entities.Reset)
	entities.Register(entities.EntityConfig{
		Name:     "widget",
		Model:    &widget{},
		BasePath: "/widgets",
	})

	r := Routes(gdb)
	req := httptest.NewRequest(http.MethodGet, "/schemas", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))

	var body SchemasResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	require.Contains(t, body.Entities, "widget")
	assert.Equal(t, "/api/v1/widgets", body.Entities["widget"].APIPath)
}

func TestBuildEmptyRegistry(t *testing.T) {
	gdb, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	resp, err := Build(gdb, nil)
	require.NoError(t, err)
	assert.Empty(t, resp.Entities)
}

type badModel struct {
	Name string
}

func TestBuildHandlesNoJSONTag(t *testing.T) {
	gdb, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	resp, err := Build(gdb, []entities.EntityConfig{{
		Name:     "bad",
		Model:    &badModel{},
		BasePath: "/bads",
	}})
	require.NoError(t, err)
	require.Contains(t, resp.Entities, "bad")
	for _, f := range resp.Entities["bad"].Fields {
		if f.Name == "Name" {
			assert.Equal(t, f.DBName, f.JSONName)
		}
	}
}
