package health

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/httputil"
)

func Routes(gdb *gorm.DB) chi.Router {
	r := chi.NewRouter()
	r.Method(http.MethodGet, "/health", apperr.H(func(w http.ResponseWriter, _ *http.Request) error {
		return httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}))
	r.Method(http.MethodGet, "/ready", apperr.H(func(w http.ResponseWriter, r *http.Request) error {
		var one int
		if err := gdb.WithContext(r.Context()).Raw("SELECT 1").Scan(&one).Error; err != nil {
			return err
		}
		return httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	}))
	return r
}
