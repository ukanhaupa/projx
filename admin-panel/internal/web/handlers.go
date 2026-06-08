package web

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"adminpanel/internal/browser"
)

type ctxKey int

const userKey ctxKey = 0

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookie)
		if err != nil {
			http.Redirect(w, r, s.base+"/login", http.StatusSeeOther)
			return
		}
		user, err := s.store.SessionUser(r.Context(), cookie.Value)
		if err != nil {
			http.Redirect(w, r, s.base+"/login", http.StatusSeeOther)
			return
		}
		ctx := contextWithUser(r, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) loginForm(w http.ResponseWriter, _ *http.Request) {
	s.render(w, "login", viewData{Title: "Sign in"})
}

func (s *Server) loginSubmit(w http.ResponseWriter, r *http.Request) {
	email := r.FormValue("email")
	password := r.FormValue("password")
	user, err := s.store.Authenticate(r.Context(), email, password)
	if err != nil {
		s.render(w, "login", viewData{Title: "Sign in", Error: "Invalid email or password."})
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
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
	http.Redirect(w, r, s.base+"/login", http.StatusSeeOther)
}

func (s *Server) tablesPage(w http.ResponseWriter, r *http.Request) {
	tables, err := s.schema.Tables(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.render(w, "tables", viewData{Title: "Tables", User: userEmail(r), Tables: tables})
}

func (s *Server) explorerPage(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "table")
	tables, table, ok := s.resolve(w, r, name)
	if !ok {
		return
	}
	offset := parseOffset(r)
	page, err := s.repo.List(r.Context(), table, offset, 0)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	prev := offset - page.Limit
	if prev < 0 {
		prev = 0
	}
	s.render(w, "explorer", viewData{
		Title:      name,
		User:       userEmail(r),
		Tables:     tables,
		Table:      name,
		PrimaryKey: table.PrimaryKey,
		CanWrite:   s.perms.CanWrite(name),
		Page:       page,
		PrevOffset: prev,
		NextOffset: offset + page.Limit,
	})
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
	s.render(w, "editor", viewData{
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
		fields = append(fields, f)
	}
	s.render(w, "editor", viewData{
		Title: "Edit " + name, User: userEmail(r), Tables: tables, Table: name,
		ID: id, Fields: fields, Action: s.base + "/tables/" + name + "/" + id,
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
	if err := s.repo.Update(r.Context(), table, id, formMap(r)); err != nil {
		s.renderEditError(w, r, name, id, false, err)
		return
	}
	http.Redirect(w, r, s.base+"/tables/"+name, http.StatusSeeOther)
}

func (s *Server) deleteRow(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "table")
	id := chi.URLParam(r, "id")
	_, table, ok := s.resolveWritable(w, r, name)
	if !ok {
		return
	}
	if err := s.repo.Delete(r.Context(), table, id); err != nil && !errors.Is(err, browser.ErrNotFound) {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, s.base+"/tables/"+name, http.StatusSeeOther)
}

func (s *Server) resolve(w http.ResponseWriter, r *http.Request, name string) ([]string, *browser.Table, bool) {
	table, err := s.schema.Table(r.Context(), name)
	if errors.Is(err, browser.ErrNotFound) {
		http.NotFound(w, r)
		return nil, nil, false
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return nil, nil, false
	}
	tables, err := s.schema.Tables(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return nil, nil, false
	}
	return tables, table, true
}

func (s *Server) resolveWritable(w http.ResponseWriter, r *http.Request, name string) ([]string, *browser.Table, bool) {
	if !s.perms.CanWrite(name) {
		http.Error(w, "table is read-only", http.StatusForbidden)
		return nil, nil, false
	}
	return s.resolve(w, r, name)
}

func (s *Server) renderEditError(w http.ResponseWriter, r *http.Request, name, id string, isNew bool, cause error) {
	tables, _ := s.schema.Tables(r.Context())
	action := s.base + "/tables/" + name + "/new"
	if !isNew {
		action = s.base + "/tables/" + name + "/" + id
	}
	w.WriteHeader(http.StatusBadRequest)
	s.render(w, "editor", viewData{
		Title: "Edit " + name, User: userEmail(r), Tables: tables, Table: name,
		ID: id, IsNew: isNew, Action: action, Error: cause.Error(),
	})
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
