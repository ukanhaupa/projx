package web

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"adminpanel/internal/audit"
	"adminpanel/internal/browser"
	"adminpanel/internal/secret"
)

type kvPair struct {
	Key   string
	Value string
}

type serviceConfigRow struct {
	ID        string
	Purpose   string
	IsActive  bool
	UpdatedAt string
}

func (s *Server) canEditConfig(r *http.Request) bool {
	return len(s.cred) > 0 && inWriteMode(r)
}

func (s *Server) requireConfigEdit(w http.ResponseWriter, r *http.Request) bool {
	if len(s.cred) == 0 {
		http.Error(w, "service config editing is not configured", http.StatusServiceUnavailable)
		return false
	}
	if !inWriteMode(r) {
		http.Error(w, "write mode is off — enable it to edit service config", http.StatusForbidden)
		return false
	}
	return true
}

func (s *Server) serviceConfigTable(w http.ResponseWriter, r *http.Request) (*browser.Table, bool) {
	table, err := s.schema.Table(r.Context(), serviceConfigsSchema, serviceConfigsTable)
	if errors.Is(err, browser.ErrNotFound) {
		http.Error(w, "service_configs table not found", http.StatusNotFound)
		return nil, false
	}
	if err != nil {
		http.Error(w, "could not load service_configs", http.StatusInternalServerError)
		return nil, false
	}
	return table, true
}

func (s *Server) serviceConfigList(w http.ResponseWriter, r *http.Request) {
	table, ok := s.serviceConfigTable(w, r)
	if !ok {
		return
	}
	page, err := s.repo.List(r.Context(), table, browser.Query{Limit: 500})
	if err != nil {
		http.Error(w, "could not list service configs", http.StatusInternalServerError)
		return
	}
	rows := make([]serviceConfigRow, 0, len(page.Rows))
	for _, row := range page.Rows {
		rows = append(rows, serviceConfigRow{
			ID:        cell(row[table.PrimaryKey]),
			Purpose:   cell(row["purpose"]),
			IsActive:  row["is_active"] == true,
			UpdatedAt: cell(row["updated_at"]),
		})
	}
	s.render(w, r, "serviceconfig_list", viewData{
		Title:         "Service Config",
		User:          userEmail(r),
		Configs:       rows,
		CanEditConfig: s.canEditConfig(r),
		CredMissing:   len(s.cred) == 0,
	})
}

func (s *Server) serviceConfigEditForm(w http.ResponseWriter, r *http.Request) {
	if !s.requireConfigEdit(w, r) {
		return
	}
	table, ok := s.serviceConfigTable(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	row, err := s.repo.Get(r.Context(), table, id)
	if errors.Is(err, browser.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "could not load config", http.StatusInternalServerError)
		return
	}
	plaintext, err := secret.Decrypt(cell(row["config"]), s.cred)
	if err != nil {
		http.Error(w, "could not decrypt config", http.StatusUnprocessableEntity)
		return
	}
	pairs, err := jsonToPairs(plaintext)
	if err != nil {
		http.Error(w, "config is not a JSON object", http.StatusUnprocessableEntity)
		return
	}
	s.logAudit(r, audit.ActionDecrypt, table, id, nil, nil)
	s.render(w, r, "serviceconfig_edit", viewData{
		Title:         "Edit " + cell(row["purpose"]),
		User:          userEmail(r),
		ID:            id,
		Purpose:       cell(row["purpose"]),
		IsActive:      row["is_active"] == true,
		Pairs:         pairs,
		Action:        s.base + "/service-config/" + url.QueryEscape(id),
		CanEditConfig: true,
	})
}

func (s *Server) serviceConfigSave(w http.ResponseWriter, r *http.Request) {
	if !s.requireConfigEdit(w, r) {
		return
	}
	table, ok := s.serviceConfigTable(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	pairs := pairsFromForm(r)
	isActive := lastFormValue(r, "is_active") == "true"
	encoded, err := pairsToJSON(pairs)
	if err != nil {
		s.renderConfigEditError(w, r, false, id, r.FormValue("purpose"), isActive, pairs, err)
		return
	}
	encrypted, err := secret.Encrypt(encoded, s.cred)
	if err != nil {
		http.Error(w, "could not encrypt config", http.StatusInternalServerError)
		return
	}
	data := map[string]string{"config": encrypted}
	if table.Column("is_active") != nil {
		data["is_active"] = boolString(isActive)
	}
	setManagedTimestamps(table, data)
	if err := s.repo.Update(r.Context(), table, id, data); err != nil {
		s.renderConfigEditError(w, r, false, id, r.FormValue("purpose"), isActive, pairs, err)
		return
	}
	s.logAudit(r, audit.ActionUpdate, table, id, nil, map[string]any{"config": "(updated)", "is_active": isActive})
	http.Redirect(w, r, s.base+"/service-config", http.StatusSeeOther)
}

func (s *Server) serviceConfigNewForm(w http.ResponseWriter, r *http.Request) {
	if !s.requireConfigEdit(w, r) {
		return
	}
	s.render(w, r, "serviceconfig_edit", viewData{
		Title:         "New service config",
		User:          userEmail(r),
		IsNew:         true,
		IsActive:      true,
		Pairs:         []kvPair{{}},
		Action:        s.base + "/service-config/new",
		CanEditConfig: true,
	})
}

func (s *Server) serviceConfigCreate(w http.ResponseWriter, r *http.Request) {
	if !s.requireConfigEdit(w, r) {
		return
	}
	table, ok := s.serviceConfigTable(w, r)
	if !ok {
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	purpose := strings.TrimSpace(r.FormValue("purpose"))
	isActive := lastFormValue(r, "is_active") == "true"
	pairs := pairsFromForm(r)
	if purpose == "" {
		s.renderConfigEditError(w, r, true, "", purpose, isActive, pairs, errors.New("purpose is required"))
		return
	}
	encoded, err := pairsToJSON(pairs)
	if err != nil {
		s.renderConfigEditError(w, r, true, "", purpose, isActive, pairs, err)
		return
	}
	encrypted, err := secret.Encrypt(encoded, s.cred)
	if err != nil {
		http.Error(w, "could not encrypt config", http.StatusInternalServerError)
		return
	}
	data := map[string]string{"purpose": purpose, "config": encrypted}
	if table.Column("is_active") != nil {
		data["is_active"] = boolString(isActive)
	}
	if pk := pkColumn(table); isStringLikePK(pk) {
		uuid, err := newUUID()
		if err != nil {
			http.Error(w, "could not generate id", http.StatusInternalServerError)
			return
		}
		data[pk.Name] = uuid
	}
	setManagedTimestamps(table, data)
	if err := s.repo.Insert(r.Context(), table, data); err != nil {
		s.renderConfigEditError(w, r, true, "", purpose, isActive, pairs, err)
		return
	}
	s.logAudit(r, audit.ActionInsert, table, "", nil, map[string]any{"purpose": purpose, "is_active": isActive})
	http.Redirect(w, r, s.base+"/service-config", http.StatusSeeOther)
}

func (s *Server) renderConfigEditError(w http.ResponseWriter, r *http.Request, isNew bool, id, purpose string, isActive bool, pairs []kvPair, cause error) {
	action := s.base + "/service-config/new"
	if !isNew {
		action = s.base + "/service-config/" + url.QueryEscape(id)
	}
	w.WriteHeader(http.StatusBadRequest)
	s.render(w, r, "serviceconfig_edit", viewData{
		Title:         "Service config",
		User:          userEmail(r),
		ID:            id,
		IsNew:         isNew,
		Purpose:       purpose,
		IsActive:      isActive,
		Pairs:         pairs,
		Action:        action,
		CanEditConfig: true,
		Error:         cause.Error(),
	})
}

func pkColumn(t *browser.Table) *browser.Column {
	for i := range t.Columns {
		if t.Columns[i].Name == t.PrimaryKey {
			return &t.Columns[i]
		}
	}
	return nil
}

func isStringLikePK(c *browser.Column) bool {
	if c == nil {
		return false
	}
	switch c.UDTName {
	case "uuid", "text", "varchar", "bpchar", "citext":
		return true
	}
	return false
}

func setManagedTimestamps(t *browser.Table, data map[string]string) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for i := range t.Columns {
		c := &t.Columns[i]
		if c.Nullable {
			continue
		}
		if _, has := data[c.Name]; has {
			continue
		}
		switch c.UDTName {
		case "timestamptz", "timestamp":
			data[c.Name] = now
		}
	}
}

func newUUID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

func lastFormValue(r *http.Request, key string) string {
	vals := r.PostForm[key]
	if len(vals) == 0 {
		return ""
	}
	return vals[len(vals)-1]
}

func pairsFromForm(r *http.Request) []kvPair {
	keys := r.PostForm["kv_key"]
	vals := r.PostForm["kv_value"]
	pairs := make([]kvPair, 0, len(keys))
	for i, k := range keys {
		v := ""
		if i < len(vals) {
			v = vals[i]
		}
		pairs = append(pairs, kvPair{Key: k, Value: v})
	}
	return pairs
}

func pairsToJSON(pairs []kvPair) (string, error) {
	obj := make(map[string]any, len(pairs))
	for _, p := range pairs {
		k := strings.TrimSpace(p.Key)
		if k == "" {
			continue
		}
		var v any
		if err := json.Unmarshal([]byte(p.Value), &v); err != nil {
			v = p.Value
		}
		obj[k] = v
	}
	b, err := json.Marshal(obj)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func jsonToPairs(s string) ([]kvPair, error) {
	var obj map[string]any
	if err := json.Unmarshal([]byte(s), &obj); err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pairs := make([]kvPair, 0, len(obj))
	for _, k := range keys {
		pairs = append(pairs, kvPair{Key: k, Value: valueToString(obj[k])})
	}
	return pairs, nil
}

func valueToString(v any) string {
	if s, ok := v.(string); ok {
		var probe any
		if json.Unmarshal([]byte(s), &probe) == nil {
			if _, stillString := probe.(string); !stillString {
				b, _ := json.Marshal(s)
				return string(b)
			}
		}
		return s
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

func boolString(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
