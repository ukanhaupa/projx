package web

import (
	"embed"
	"fmt"
	"html/template"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"adminpanel/internal/auth"
	"adminpanel/internal/browser"
)

//go:embed templates/*.html
var templateFS embed.FS

//go:embed static/*
var staticFS embed.FS

const sessionCookie = "admin_session"

type Server struct {
	base   string
	store  *auth.Store
	schema *browser.Schema
	repo   *browser.Repo
	perms  *browser.Perms
	tmpl   map[string]*template.Template
	secure bool
}

func NewServer(base string, store *auth.Store, schema *browser.Schema, repo *browser.Repo, perms *browser.Perms) (*Server, error) {
	s := &Server{base: base, store: store, schema: schema, repo: repo, perms: perms}
	if err := s.parseTemplates(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Server) parseTemplates() error {
	funcs := template.FuncMap{"cell": cell}
	pages := []string{"login", "tables", "explorer", "editor"}
	s.tmpl = make(map[string]*template.Template, len(pages))
	for _, p := range pages {
		t, err := template.New("layout.html").Funcs(funcs).ParseFS(templateFS,
			"templates/layout.html", "templates/"+p+".html")
		if err != nil {
			return err
		}
		s.tmpl[p] = t
	}
	return nil
}

func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	r.Handle(s.base+"/static/*", http.StripPrefix(s.base+"/", http.FileServer(http.FS(staticFS))))

	r.Get(s.base+"/healthz", s.healthz)
	r.Get(s.base+"/login", s.loginForm)
	r.Post(s.base+"/login", s.loginSubmit)
	r.Post(s.base+"/logout", s.logout)

	r.Group(func(pr chi.Router) {
		pr.Use(s.requireAuth)
		pr.Get(s.base+"/", s.tablesPage)
		pr.Get(s.base+"/tables/{table}", s.explorerPage)
		pr.Get(s.base+"/tables/{table}/new", s.newRowForm)
		pr.Post(s.base+"/tables/{table}/new", s.createRow)
		pr.Get(s.base+"/tables/{table}/{id}", s.editRowForm)
		pr.Post(s.base+"/tables/{table}/{id}", s.updateRow)
		pr.Post(s.base+"/tables/{table}/{id}/delete", s.deleteRow)
	})

	return r
}

type viewData struct {
	Title      string
	Base       string
	User       string
	Error      string
	Tables     []string
	Table      string
	PrimaryKey string
	CanWrite   bool
	Page       *browser.Page
	PrevOffset int
	NextOffset int
	Fields     []field
	Action     string
	ID         string
	IsNew      bool
}

type field struct {
	Name     string
	DataType string
	Input    browser.InputKind
	Value    string
	Checked  bool
	ReadOnly bool
}

func (s *Server) render(w http.ResponseWriter, page string, data viewData) {
	data.Base = s.base
	t, ok := s.tmpl[page]
	if !ok {
		http.Error(w, "template not found", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := t.ExecuteTemplate(w, "layout", data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	fmt.Fprintln(w, "ok")
}

func cell(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case []byte:
		return string(t)
	case time.Time:
		return t.Format(time.RFC3339)
	default:
		return fmt.Sprintf("%v", t)
	}
}

func parseOffset(r *http.Request) int {
	n, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if n < 0 {
		return 0
	}
	return n
}
