package health

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/httputil"
)

type Pinger interface {
	PingContext(ctx context.Context) error
}

func Routes(p Pinger) chi.Router {
	r := chi.NewRouter()
	r.Method(http.MethodGet, "/health", apperr.H(func(w http.ResponseWriter, _ *http.Request) error {
		return httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}))
	r.Method(http.MethodGet, "/ready", apperr.H(func(w http.ResponseWriter, r *http.Request) error {
		if err := p.PingContext(r.Context()); err != nil {
			return err
		}
		return httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	}))
	return r
}
