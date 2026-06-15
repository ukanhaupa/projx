package health

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/httputil"
)

func Routes(pool *sql.DB) chi.Router {
	r := chi.NewRouter()
	r.Method(http.MethodGet, "/health", apperr.H(func(w http.ResponseWriter, _ *http.Request) error {
		return httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}))
	r.Method(http.MethodGet, "/ready", apperr.H(func(w http.ResponseWriter, r *http.Request) error {
		var one int
		if err := pool.QueryRowContext(r.Context(), "SELECT 1").Scan(&one); err != nil {
			return err
		}
		return httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	}))
	return r
}
