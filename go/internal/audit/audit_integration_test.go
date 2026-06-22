package audit_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/audit"
	"projx.local/go/internal/auth"
	"projx.local/go/internal/db"
	"projx.local/go/internal/entities"
	"projx.local/go/internal/requestid"
	"projx.local/go/internal/uuid"
)

const auditTable = "audit_widgets"

type auditWidget struct {
	ID        string         `gorm:"primaryKey;type:uuid" json:"id"`
	Title     string         `gorm:"not null" json:"title" validate:"required,max=200"`
	Published bool           `json:"published"`
	CreatedAt int64          `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt int64          `gorm:"autoUpdateTime" json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (auditWidget) TableName() string { return auditTable }

func (w *auditWidget) BeforeCreate(_ *gorm.DB) error {
	if w.ID == "" {
		w.ID = uuid.V4()
	}
	return nil
}

func widgetConfig() entities.EntityConfig {
	return entities.EntityConfig{
		Name:             "audit_widget",
		Model:            &auditWidget{},
		BasePath:         "/audit-widgets",
		SearchableFields: []string{"title"},
		SoftDelete:       true,
	}
}

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	if testing.Short() {
		t.Skip("integration test skipped in short mode")
	}
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL not set")
	}
	gdb, err := db.Open(context.Background())
	require.NoError(t, err)
	require.NoError(t, gdb.Migrator().DropTable(&auditWidget{}, &audit.AuditLog{}))
	require.NoError(t, gdb.AutoMigrate(&auditWidget{}, &audit.AuditLog{}))
	return gdb
}

func injectActor(actor string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if actor != "" {
				ctx := auth.WithUser(r.Context(), &auth.AuthUser{Email: actor})
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	}
}

func mount(t *testing.T, gdb *gorm.DB, actor string) (*httptest.Server, func()) {
	t.Helper()
	entities.Reset()
	entities.Register(widgetConfig())
	r := chi.NewRouter()
	r.Use(requestid.Middleware)
	r.Use(injectActor(actor))
	r.Use(apperr.Recoverer)
	for _, cfg := range entities.All() {
		entities.MountEntity(r, gdb, cfg)
	}
	srv := httptest.NewServer(r)
	return srv, func() {
		srv.Close()
		entities.Reset()
	}
}

func do(t *testing.T, method, url string, body any) (*http.Response, []byte) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		require.NoError(t, err)
		reader = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, url, reader)
	require.NoError(t, err)
	if reader != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	t.Cleanup(func() { resp.Body.Close() })
	respBody, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp, respBody
}

func auditRows(t *testing.T, gdb *gorm.DB, recordID string) []audit.AuditLog {
	t.Helper()
	var rows []audit.AuditLog
	require.NoError(t, gdb.Where("table_name = ? AND record_id = ?", auditTable, recordID).
		Order("performed_at asc").Find(&rows).Error)
	return rows
}

func countByAction(t *testing.T, gdb *gorm.DB, action audit.Action) int64 {
	t.Helper()
	var n int64
	require.NoError(t, gdb.Model(&audit.AuditLog{}).
		Where("table_name = ? AND action = ?", auditTable, action).Count(&n).Error)
	return n
}

func createWidget(t *testing.T, url, title string) auditWidget {
	t.Helper()
	resp, body := do(t, http.MethodPost, url+"/audit-widgets", map[string]any{"title": title})
	require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
	var w auditWidget
	require.NoError(t, json.Unmarshal(body, &w))
	return w
}

func TestSingleCreateWritesOneInsertRow(t *testing.T) {
	gdb := openTestDB(t)
	srv, cleanup := mount(t, gdb, "alice@example.com")
	defer cleanup()

	created := createWidget(t, srv.URL, "Hello")

	rows := auditRows(t, gdb, created.ID)
	require.Len(t, rows, 1)
	row := rows[0]
	require.Equal(t, auditTable, row.TargetTable)
	require.Equal(t, created.ID, row.RecordID)
	require.Equal(t, audit.ActionInsert, row.Action)
	require.Nil(t, row.OldValue)
	require.NotNil(t, row.NewValue)
	require.Equal(t, "Hello", row.NewValue["title"])
	require.Equal(t, "alice@example.com", row.PerformedBy)
}

func TestSingleUpdateWritesOneUpdateRowWithPrePostImages(t *testing.T) {
	gdb := openTestDB(t)
	srv, cleanup := mount(t, gdb, "")
	defer cleanup()

	created := createWidget(t, srv.URL, "Before")

	resp, body := do(t, http.MethodPatch, srv.URL+"/audit-widgets/"+created.ID, map[string]any{
		"title":     "After",
		"published": true,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode, string(body))

	rows := auditRows(t, gdb, created.ID)
	require.Len(t, rows, 2)
	upd := rows[1]
	require.Equal(t, audit.ActionUpdate, upd.Action)
	require.NotNil(t, upd.OldValue)
	require.NotNil(t, upd.NewValue)
	require.Equal(t, "Before", upd.OldValue["title"])
	require.Equal(t, "After", upd.NewValue["title"])
	require.Equal(t, true, upd.NewValue["published"])
	require.Equal(t, audit.SystemActor, upd.PerformedBy)
}

func TestSingleDeleteWritesOneDeleteRowWithPreImage(t *testing.T) {
	gdb := openTestDB(t)
	srv, cleanup := mount(t, gdb, "")
	defer cleanup()

	created := createWidget(t, srv.URL, "Doomed")

	resp, _ := do(t, http.MethodDelete, srv.URL+"/audit-widgets/"+created.ID, nil)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)

	rows := auditRows(t, gdb, created.ID)
	require.Len(t, rows, 2)
	del := rows[1]
	require.Equal(t, audit.ActionDelete, del.Action)
	require.NotNil(t, del.OldValue)
	require.Equal(t, "Doomed", del.OldValue["title"])
	require.Nil(t, del.NewValue)
}

func TestBulkCreateWritesOneInsertRowPerRecord(t *testing.T) {
	gdb := openTestDB(t)
	srv, cleanup := mount(t, gdb, "bulk@example.com")
	defer cleanup()

	resp, body := do(t, http.MethodPost, srv.URL+"/audit-widgets/bulk", []map[string]any{
		{"title": "Alpha"},
		{"title": "Beta"},
		{"title": "Gamma"},
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
	var created []auditWidget
	require.NoError(t, json.Unmarshal(body, &created))
	require.Len(t, created, 3)

	require.EqualValues(t, 3, countByAction(t, gdb, audit.ActionInsert))
	for _, w := range created {
		rows := auditRows(t, gdb, w.ID)
		require.Len(t, rows, 1, "each bulk-created record must have exactly one INSERT audit row")
		require.Equal(t, audit.ActionInsert, rows[0].Action)
		require.Equal(t, w.ID, rows[0].RecordID)
		require.Nil(t, rows[0].OldValue)
		require.NotNil(t, rows[0].NewValue)
		require.Equal(t, w.Title, rows[0].NewValue["title"])
		require.Equal(t, "bulk@example.com", rows[0].PerformedBy)
	}
}

func TestBulkDeleteWritesOneDeleteRowPerRecord(t *testing.T) {
	gdb := openTestDB(t)
	srv, cleanup := mount(t, gdb, "")
	defer cleanup()

	a := createWidget(t, srv.URL, "Keep")
	b := createWidget(t, srv.URL, "Drop1")
	c := createWidget(t, srv.URL, "Drop2")

	resp, body := do(t, http.MethodDelete, srv.URL+"/audit-widgets/bulk", map[string]any{
		"ids": []string{b.ID, c.ID},
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode, string(body))

	require.EqualValues(t, 2, countByAction(t, gdb, audit.ActionDelete))
	for _, deleted := range []auditWidget{b, c} {
		rows := auditRows(t, gdb, deleted.ID)
		var delRow *audit.AuditLog
		for i := range rows {
			if rows[i].Action == audit.ActionDelete {
				delRow = &rows[i]
			}
		}
		require.NotNil(t, delRow, "each bulk-deleted record must have a DELETE audit row")
		require.NotNil(t, delRow.OldValue)
		require.Equal(t, deleted.Title, delRow.OldValue["title"])
		require.Nil(t, delRow.NewValue)
	}

	var aDeletes []audit.AuditLog
	require.NoError(t, gdb.Where("table_name = ? AND record_id = ? AND action = ?", auditTable, a.ID, audit.ActionDelete).
		Find(&aDeletes).Error)
	require.Empty(t, aDeletes, "the untouched record must not have a DELETE audit row")
}

func TestAuditTableIsNeverAudited(t *testing.T) {
	gdb := openTestDB(t)
	srv, cleanup := mount(t, gdb, "")
	defer cleanup()

	for i := 0; i < 3; i++ {
		createWidget(t, srv.URL, "X")
	}

	require.EqualValues(t, 3, countByAction(t, gdb, audit.ActionInsert))

	var auditOfAudit int64
	require.NoError(t, gdb.Model(&audit.AuditLog{}).Where("table_name = ?", "audit_logs").Count(&auditOfAudit).Error)
	require.EqualValues(t, 0, auditOfAudit)
}

func TestNoAuditRowWhenCreateFailsValidation(t *testing.T) {
	gdb := openTestDB(t)
	srv, cleanup := mount(t, gdb, "")
	defer cleanup()

	resp, _ := do(t, http.MethodPost, srv.URL+"/audit-widgets", map[string]any{"published": true})
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)

	require.EqualValues(t, 0, countByAction(t, gdb, audit.ActionInsert))
}
