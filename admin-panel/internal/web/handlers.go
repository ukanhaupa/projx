package web

import (
	"encoding/csv"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"

	"adminpanel/internal/audit"
	"adminpanel/internal/auth"
	"adminpanel/internal/browser"
)

type ctxKey int

const userKey ctxKey = 0

const (
	adminSchema     = "admin_panel"
	adminUsersTable = "admin_users"
	roleColumn      = "role"
)

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookie)
		if err != nil {
			http.Redirect(w, r, s.base+"/login", http.StatusSeeOther)
			return
		}
		sess, err := s.store.LoadSession(r.Context(), cookie.Value)
		if err != nil {
			http.Redirect(w, r, s.base+"/login", http.StatusSeeOther)
			return
		}
		ctx := contextWithSession(r, sess)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) loginForm(w http.ResponseWriter, r *http.Request) {
	s.render(w, r, "login", viewData{Title: "Sign in"})
}

func (s *Server) loginSubmit(w http.ResponseWriter, r *http.Request) {
	email := r.FormValue("email")
	password := r.FormValue("password")
	user, err := s.store.Authenticate(r.Context(), email, password)
	if err != nil {
		s.render(w, r, "login", viewData{Title: "Sign in", Error: "Invalid email or password."})
		return
	}
	token, err := s.store.CreateSession(r.Context(), user.ID)
	if err != nil {
		http.Error(w, "could not create session", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.secure,
	})
	http.Redirect(w, r, s.base+"/", http.StatusSeeOther)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		_ = s.store.DeleteSession(r.Context(), cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.secure,
	})
	http.Redirect(w, r, s.base+"/login", http.StatusSeeOther)
}

func (s *Server) toggleMode(w http.ResponseWriter, r *http.Request) {
	on := r.FormValue("write") == "on"
	_, err := s.store.SetWriteMode(r.Context(), sessionToken(r), on)
	if errors.Is(err, auth.ErrReadOnlyRole) {
		http.Error(w, "your account is read-only", http.StatusForbidden)
		return
	}
	if err != nil {
		http.Error(w, "could not change mode", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, safeRedirect(s.base, r.FormValue("return")), http.StatusSeeOther)
}

func (s *Server) switchSchema(w http.ResponseWriter, r *http.Request) {
	name := r.FormValue("schema")
	ok, err := s.schema.IsBrowsable(r.Context(), name)
	if err != nil {
		http.Error(w, "could not validate schema", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "schema is not browsable", http.StatusBadRequest)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     schemaCookie,
		Value:    name,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.secure,
	})
	http.Redirect(w, r, safeRedirect(s.base, r.FormValue("return")), http.StatusSeeOther)
}

func safeRedirect(base, raw string) string {
	if raw == "" {
		return base + "/"
	}
	if len(raw) > 0 && raw[0] == '/' && (len(raw) == 1 || raw[1] != '/') {
		return raw
	}
	return base + "/"
}

func (s *Server) tablesPage(w http.ResponseWriter, r *http.Request) {
	tables, err := s.schema.Tables(r.Context(), currentSchema(r))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.render(w, r, "tables", viewData{Title: "Tables", User: userEmail(r), Tables: tables})
}

func (s *Server) explorerPage(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "table")
	tables, table, ok := s.resolve(w, r, name)
	if !ok {
		return
	}
	q := browser.ParseQuery(r.URL.Query())
	page, err := s.repo.List(r.Context(), table, q)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	total, err := s.repo.Count(r.Context(), table, q)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	page.Total = total
	prev := page.Offset - page.Limit
	if prev < 0 {
		prev = 0
	}
	prevURL := pagedURL(q, prev)
	nextURL := pagedURL(q, page.Offset+page.Limit)
	exportURL := s.base + "/tables/" + name + ".csv?" + q.WithoutPagination().Encode()
	data := viewData{
		Title:        name,
		User:         userEmail(r),
		Tables:       tables,
		Table:        name,
		PrimaryKey:   table.PrimaryKey,
		Columns:      columnViews(table),
		Page:         page,
		PrevOffset:   prev,
		NextOffset:   page.Offset + page.Limit,
		PrevURL:      prevURL,
		NextURL:      nextURL,
		ExportURL:    exportURL,
		Sort:         q.Sort,
		Search:       q.Search,
		ActiveFilter: q.Filters,
		Total:        total,
	}
	if isHTMXRequest(r) {
		s.renderTableFragment(w, r, data)
		return
	}
	s.render(w, r, "explorer", data)
}

func (s *Server) addFilter(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "table")
	_, table, ok := s.resolve(w, r, name)
	if !ok {
		return
	}
	col := r.URL.Query().Get("filter_col")
	op := r.URL.Query().Get("filter_op")
	val := r.URL.Query().Get("filter_val")
	if col == "" || op == "" {
		http.Redirect(w, r, s.base+"/tables/"+name, http.StatusSeeOther)
		return
	}
	if table.Column(col) == nil {
		http.Error(w, "unknown column", http.StatusBadRequest)
		return
	}
	q := browser.ParseQuery(r.URL.Query())
	q.Filters = append(q.Filters, browser.Filter{
		Column:   col,
		Operator: browser.Operator(op),
		Values:   []string{val},
	})
	q.Offset = 0
	newURL := s.base + "/tables/" + name + "?" + q.Encode()
	if isHTMXRequest(r) {
		r2 := r.Clone(r.Context())
		r2.URL.RawQuery = q.Encode()
		w.Header().Set("HX-Push-Url", newURL)
		s.explorerPage(w, r2)
		return
	}
	http.Redirect(w, r, newURL, http.StatusSeeOther)
}

func (s *Server) exportTableCSV(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "table")
	_, table, ok := s.resolve(w, r, name)
	if !ok {
		return
	}
	q := browser.ParseQuery(r.URL.Query()).WithoutPagination()

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`.csv"`)
	cw := csv.NewWriter(w)
	defer cw.Flush()

	header := make([]string, len(table.Columns))
	for i, c := range table.Columns {
		header[i] = c.Name
	}
	_ = cw.Write(header)

	if err := s.repo.StreamAll(r.Context(), table, q, 10000, func(row browser.Row) error {
		rec := make([]string, len(table.Columns))
		for i, c := range table.Columns {
			rec[i] = cell(row[c.Name])
		}
		return cw.Write(rec)
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func pagedURL(q browser.Query, offset int) string {
	q2 := q
	q2.Offset = offset
	return "?" + q2.Encode()
}

func columnViews(t *browser.Table) []columnView {
	out := make([]columnView, 0, len(t.Columns))
	for _, c := range t.Columns {
		out = append(out, columnView{
			Name:      c.Name,
			DataType:  c.DataType,
			UDTName:   c.UDTName,
			Operators: operatorsFor(&c),
			FK:        c.FK,
		})
	}
	return out
}

func operatorsFor(c *browser.Column) []browser.Operator {
	switch c.UDTName {
	case "text", "citext", "varchar", "bpchar":
		return []browser.Operator{browser.OpEq, browser.OpNeq, browser.OpILike, browser.OpStartsWith, browser.OpEndsWith, browser.OpIn, browser.OpIsNull, browser.OpIsNotNull}
	case "int2", "int4", "int8", "numeric", "float4", "float8":
		return []browser.Operator{browser.OpEq, browser.OpNeq, browser.OpGt, browser.OpGte, browser.OpLt, browser.OpLte, browser.OpIn, browser.OpIsNull, browser.OpIsNotNull}
	case "bool":
		return []browser.Operator{browser.OpEq, browser.OpNeq, browser.OpIsNull, browser.OpIsNotNull}
	case "timestamptz", "timestamp", "date":
		return []browser.Operator{browser.OpEq, browser.OpNeq, browser.OpGt, browser.OpGte, browser.OpLt, browser.OpLte, browser.OpBetween, browser.OpIsNull, browser.OpIsNotNull}
	case "uuid":
		return []browser.Operator{browser.OpEq, browser.OpNeq, browser.OpIn, browser.OpIsNull, browser.OpIsNotNull}
	case "json", "jsonb":
		return []browser.Operator{browser.OpContainsKey, browser.OpIsNull, browser.OpIsNotNull}
	}
	return []browser.Operator{browser.OpEq, browser.OpNeq, browser.OpIsNull, browser.OpIsNotNull}
}

func (s *Server) newRowForm(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "table")
	tables, table, ok := s.resolveWritable(w, r, name)
	if !ok {
		return
	}
	fields := make([]field, 0, len(table.Columns))
	for _, c := range table.Columns {
		fields = append(fields, field{
			Name: c.Name, DataType: c.DataType, Input: c.Input(),
			ReadOnly: c.Name == table.PrimaryKey,
		})
	}
	s.render(w, r, "editor", viewData{
		Title: "New row", User: userEmail(r), Tables: tables, Table: name,
		IsNew: true, Fields: fields, Action: s.base + "/tables/" + name + "/new",
	})
}

func (s *Server) createRow(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "table")
	_, table, ok := s.resolveWritable(w, r, name)
	if !ok {
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	data := formMap(r)
	if err := s.repo.Insert(r.Context(), table, data); err != nil {
		s.renderEditError(w, r, name, "", true, err)
		return
	}
	s.logAudit(r, audit.ActionInsert, table, "", nil, stringMapToAny(data))
	http.Redirect(w, r, s.base+"/tables/"+name, http.StatusSeeOther)
}

func (s *Server) editRowForm(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "table")
	id := chi.URLParam(r, "id")
	tables, table, ok := s.resolveWritable(w, r, name)
	if !ok {
		return
	}
	row, err := s.repo.Get(r.Context(), table, id)
	if errors.Is(err, browser.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	fields := make([]field, 0, len(table.Columns))
	for _, c := range table.Columns {
		f := field{
			Name: c.Name, DataType: c.DataType, Input: c.Input(),
			Value: cell(row[c.Name]), ReadOnly: c.Name == table.PrimaryKey,
		}
		if c.Input() == browser.InputCheckbox {
			f.Checked = row[c.Name] == true
		}
		if isOwnAdminUserRow(table, id, currentUser(r)) && c.Name == roleColumn {
			f.ReadOnly = true
		}
		fields = append(fields, f)
	}
	s.render(w, r, "editor", viewData{
		Title: "Edit " + name, User: userEmail(r), Tables: tables, Table: name,
		ID: id, Fields: fields, Action: s.base + "/tables/" + name + "/" + url.QueryEscape(id),
	})
}

func (s *Server) updateRow(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "table")
	id := chi.URLParam(r, "id")
	_, table, ok := s.resolveWritable(w, r, name)
	if !ok {
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	data := formMap(r)
	if isOwnAdminUserRow(table, id, currentUser(r)) {
		delete(data, roleColumn)
	}
	before, _ := s.repo.Get(r.Context(), table, id)
	if err := s.repo.Update(r.Context(), table, id, data); err != nil {
		s.renderEditError(w, r, name, id, false, err)
		return
	}
	s.logAudit(r, audit.ActionUpdate, table, id, before, stringMapToAny(data))
	http.Redirect(w, r, s.base+"/tables/"+name, http.StatusSeeOther)
}

func (s *Server) deleteRow(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "table")
	id := chi.URLParam(r, "id")
	_, table, ok := s.resolveWritable(w, r, name)
	if !ok {
		return
	}
	if isOwnAdminUserRow(table, id, currentUser(r)) {
		http.Error(w, "cannot delete your own admin account", http.StatusForbidden)
		return
	}
	before, _ := s.repo.Get(r.Context(), table, id)
	if err := s.repo.Delete(r.Context(), table, id); err != nil && !errors.Is(err, browser.ErrNotFound) {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.logAudit(r, audit.ActionDelete, table, id, before, nil)
	http.Redirect(w, r, s.base+"/tables/"+name, http.StatusSeeOther)
}

func isOwnAdminUserRow(table *browser.Table, id string, u *auth.AdminUser) bool {
	if u == nil || table == nil {
		return false
	}
	if table.Schema != adminSchema || table.Name != adminUsersTable {
		return false
	}
	rowID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		return false
	}
	return rowID == u.ID
}

func (s *Server) resolve(w http.ResponseWriter, r *http.Request, name string) ([]string, *browser.Table, bool) {
	schema := currentSchema(r)
	table, err := s.schema.Table(r.Context(), schema, name)
	if errors.Is(err, browser.ErrNotFound) {
		http.NotFound(w, r)
		return nil, nil, false
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return nil, nil, false
	}
	tables, err := s.schema.Tables(r.Context(), schema)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return nil, nil, false
	}
	return tables, table, true
}

func (s *Server) resolveWritable(w http.ResponseWriter, r *http.Request, name string) ([]string, *browser.Table, bool) {
	if !inWriteMode(r) {
		http.Error(w, "write mode is off — enable it to make changes", http.StatusForbidden)
		return nil, nil, false
	}
	return s.resolve(w, r, name)
}

func (s *Server) renderEditError(w http.ResponseWriter, r *http.Request, name, id string, isNew bool, cause error) {
	tables, _ := s.schema.Tables(r.Context(), currentSchema(r))
	action := s.base + "/tables/" + name + "/new"
	if !isNew {
		action = s.base + "/tables/" + name + "/" + id
	}
	w.WriteHeader(http.StatusBadRequest)
	s.render(w, r, "editor", viewData{
		Title: "Edit " + name, User: userEmail(r), Tables: tables, Table: name,
		ID: id, IsNew: isNew, Action: action, Error: cause.Error(),
	})
}

func (s *Server) logAudit(r *http.Request, action audit.Action, t *browser.Table, recordID string, oldValue, newValue map[string]any) {
	if s.audit == nil {
		return
	}
	u := currentUser(r)
	if u == nil {
		return
	}
	_ = s.audit.Log(r.Context(), audit.Entry{
		PerformedBy: u.ID,
		TableSchema: t.Schema,
		TableName:   t.Name,
		RecordID:    recordID,
		Action:      action,
		OldValue:    oldValue,
		NewValue:    newValue,
	})
}

func stringMapToAny(m map[string]string) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func formMap(r *http.Request) map[string]string {
	data := make(map[string]string)
	for key, vals := range r.PostForm {
		if len(vals) > 0 {
			data[key] = vals[len(vals)-1]
		}
	}
	return data
}
