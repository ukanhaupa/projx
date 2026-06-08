package web

import (
	"embed"
	"fmt"
	"html/template"
	"net/http"

	"github.com/go-chi/chi/v5"

	"adminpanel/internal/audit"
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
	audit  *audit.Logger
	tmpl   map[string]*template.Template
	secure bool
}

func NewServer(base string, store *auth.Store, schema *browser.Schema, repo *browser.Repo, audit *audit.Logger) (*Server, error) {
	s := &Server{base: base, store: store, schema: schema, repo: repo, audit: audit}
	if err := s.parseTemplates(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Server) parseTemplates() error {
	funcs := template.FuncMap{
		"cell":            cell,
		"renderCell":      renderCell,
		"sortToggleURL":   sortToggleURL,
		"sortIndicator":   sortIndicator,
		"removeFilterURL": removeFilterURL,
		"add":             func(a, b int) int { return a + b },
		"addPageLen":      func(p *browser.Page) int { return p.Offset + len(p.Rows) },
	}
	pages := []string{"login", "tables", "explorer", "editor"}
	s.tmpl = make(map[string]*template.Template, len(pages))
	for _, p := range pages {
		t, err := template.New("layout.html").Funcs(funcs).ParseFS(templateFS,
			"templates/layout.html", "templates/"+p+".html")
		if err != nil {
			return err
		}
		if p == "explorer" {
			if _, err := t.ParseFS(templateFS, "templates/_table.html"); err != nil {
				return err
			}
		}
		s.tmpl[p] = t
	}
	tableFrag, err := template.New("table-region").Funcs(funcs).ParseFS(templateFS, "templates/_table.html")
	if err != nil {
		return err
	}
	s.tmpl["_table"] = tableFrag
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
		pr.Use(noCacheMiddleware)
		pr.Use(s.requireAuth)
		pr.Post(s.base+"/mode", s.toggleMode)
		pr.Post(s.base+"/schema", s.switchSchema)
		pr.Get(s.base+"/", s.tablesPage)
		pr.Get(s.base+"/tables/{table}.csv", s.exportTableCSV)
		pr.Get(s.base+"/tables/{table}/_filter", s.addFilter)
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
	Title        string
	Base         string
	User         string
	Error        string
	Schemas      []string
	Schema       string
	Tables       []string
	Table        string
	PrimaryKey   string
	Columns      []columnView
	CanWrite     bool
	WriteMode    bool
	WriteExpires string
	Page         *browser.Page
	PrevOffset   int
	NextOffset   int
	PrevURL      string
	NextURL      string
	ExportURL    string
	Sort         []browser.SortKey
	Search       string
	ActiveFilter []browser.Filter
	Total        int
	Fields       []field
	Action       string
	ID           string
	IsNew        bool
}

type columnView struct {
	Name      string
	DataType  string
	UDTName   string
	Operators []browser.Operator
	FK        *browser.ForeignKey
}

type field struct {
	Name     string
	DataType string
	Input    browser.InputKind
	Value    string
	Checked  bool
	ReadOnly bool
}

func (s *Server) render(w http.ResponseWriter, r *http.Request, page string, data viewData) {
	s.applyChrome(r, &data)
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

func (s *Server) renderTableFragment(w http.ResponseWriter, r *http.Request, data viewData) {
	s.applyChrome(r, &data)
	t, ok := s.tmpl["_table"]
	if !ok {
		http.Error(w, "fragment template not found", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := t.ExecuteTemplate(w, "table-region", data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (s *Server) applyChrome(r *http.Request, data *viewData) {
	data.Base = s.base
	if r == nil {
		return
	}
	if data.Schema == "" {
		data.Schema = currentSchema(r)
	}
	data.CanWrite = canWrite(r)
	data.WriteMode = inWriteMode(r)
	if exp := writeExpires(r); !exp.IsZero() {
		data.WriteExpires = exp.Format("15:04 MST")
	}
	if data.Schemas == nil {
		if list, err := s.schema.ListSchemas(r.Context()); err == nil {
			data.Schemas = list
		}
	}
}

func isHTMXRequest(r *http.Request) bool {
	return r.Header.Get("HX-Request") == "true"
}

func noCacheMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, private")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprintln(w, "ok")
}
