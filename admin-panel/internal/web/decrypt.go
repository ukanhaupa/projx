package web

import (
	"errors"
	"html/template"
	"net/http"

	"github.com/go-chi/chi/v5"

	"adminpanel/internal/audit"
	"adminpanel/internal/browser"
	"adminpanel/internal/secret"
)

const (
	serviceConfigsSchema = "public"
	serviceConfigsTable  = "service_configs"
	encryptedConfigCol   = "config"
)

func isEncryptedCell(t *browser.Table, schema, colName string) bool {
	if t == nil {
		return false
	}
	if schema == "" {
		schema = serviceConfigsSchema
	}
	return schema == serviceConfigsSchema &&
		t.Name == serviceConfigsTable &&
		colName == encryptedConfigCol
}

func (s *Server) decryptCell(w http.ResponseWriter, r *http.Request) {
	if len(s.cred) == 0 {
		http.Error(w, "decryption is not configured", http.StatusServiceUnavailable)
		return
	}
	if !inWriteMode(r) {
		http.Error(w, "write mode is off — enable it to decrypt", http.StatusForbidden)
		return
	}

	name := chi.URLParam(r, "table")
	id := chi.URLParam(r, "id")
	col := r.URL.Query().Get("col")

	schema := currentSchema(r)
	_, table, ok := s.resolve(w, r, name)
	if !ok {
		return
	}
	if !isEncryptedCell(table, schema, col) {
		http.Error(w, "column is not decryptable", http.StatusBadRequest)
		return
	}

	row, err := s.repo.Get(r.Context(), table, id)
	if errors.Is(err, browser.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "could not load row", http.StatusInternalServerError)
		return
	}

	payload, _ := row[col].(string)
	plaintext, err := secret.Decrypt(payload, s.cred)
	if err != nil {
		http.Error(w, "could not decrypt value", http.StatusUnprocessableEntity)
		return
	}

	s.logAudit(r, audit.ActionDecrypt, table, id, nil, nil)

	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, private")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<span class="decrypted">` +
		template.HTMLEscapeString(plaintext) + `</span>`))
}
