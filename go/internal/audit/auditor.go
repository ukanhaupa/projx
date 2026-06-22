package audit

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"reflect"

	"gorm.io/gorm"

	"projx.local/go/internal/auth"
	"projx.local/go/internal/requestid"
)

const SystemActor = "system"

var skippedTables = map[string]struct{}{
	"audit_logs":      {},
	"service_configs": {},
}

func Skipped(table string) bool {
	_, ok := skippedTables[table]
	return ok
}

func Actor(r *http.Request) string {
	if r == nil {
		return SystemActor
	}
	if u, ok := auth.FromContext(r.Context()); ok && u != nil {
		if u.Email != "" {
			return u.Email
		}
		if u.ID != "" {
			return u.ID
		}
	}
	return SystemActor
}

type Auditor struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Auditor {
	if db == nil {
		return &Auditor{}
	}
	return &Auditor{db: db.Session(&gorm.Session{SkipDefaultTransaction: true})}
}

func (a *Auditor) write(ctx context.Context, table, recordID string, action Action, oldValue, newValue JSON, actor string) {
	if a == nil || a.db == nil || Skipped(table) {
		return
	}
	row := AuditLog{
		TargetTable: table,
		RecordID:    recordID,
		Action:      action,
		OldValue:    oldValue,
		NewValue:    newValue,
		PerformedBy: actor,
	}
	if err := a.db.WithContext(ctx).Create(&row).Error; err != nil {
		slog.Error("failed to write audit log",
			"request_id", requestid.FromContext(ctx),
			"table", table,
			"record_id", recordID,
			"action", action,
			"error", err.Error(),
		)
	}
}

func (a *Auditor) RecordInsert(r *http.Request, table string, records ...any) {
	if a == nil || Skipped(table) {
		return
	}
	actor := Actor(r)
	ctx := contextOf(r)
	for _, rec := range records {
		a.write(ctx, table, idOf(rec), ActionInsert, nil, asJSON(rec), actor)
	}
}

func (a *Auditor) RecordUpdate(r *http.Request, table string, before, after any) {
	if a == nil || Skipped(table) {
		return
	}
	id := idOf(after)
	if id == "" {
		id = idOf(before)
	}
	a.write(contextOf(r), table, id, ActionUpdate, asJSON(before), asJSON(after), Actor(r))
}

func (a *Auditor) RecordDelete(r *http.Request, table string, befores ...any) {
	if a == nil || Skipped(table) {
		return
	}
	actor := Actor(r)
	ctx := contextOf(r)
	for _, rec := range befores {
		a.write(ctx, table, idOf(rec), ActionDelete, asJSON(rec), nil, actor)
	}
}

func contextOf(r *http.Request) context.Context {
	if r == nil {
		return context.Background()
	}
	return r.Context()
}

func asJSON(record any) JSON {
	if record == nil {
		return nil
	}
	b, err := json.Marshal(record)
	if err != nil {
		return nil
	}
	out := JSON{}
	if err := json.Unmarshal(b, &out); err != nil {
		return nil
	}
	return out
}

func idOf(record any) string {
	if record == nil {
		return ""
	}
	v := reflect.ValueOf(record)
	for v.Kind() == reflect.Pointer {
		if v.IsNil() {
			return ""
		}
		v = v.Elem()
	}
	if v.Kind() != reflect.Struct {
		return ""
	}
	f := v.FieldByName("ID")
	if !f.IsValid() {
		return ""
	}
	if f.Kind() == reflect.String {
		return f.String()
	}
	if s, ok := f.Interface().(interface{ String() string }); ok {
		return s.String()
	}
	return ""
}
