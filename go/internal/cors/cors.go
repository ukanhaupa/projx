package cors

import (
	"net/http"
	"os"
	"strconv"
	"strings"

	"projx.local/go/internal/apperr"
)

const EnvAllowOrigins = "CORS_ALLOW_ORIGINS"

type Options struct {
	AllowedOrigins   []string
	AllowedMethods   []string
	AllowedHeaders   []string
	AllowCredentials bool
	MaxAge           int
}

var (
	defaultMethods = []string{
		http.MethodGet,
		http.MethodPost,
		http.MethodPatch,
		http.MethodDelete,
		http.MethodOptions,
	}
	defaultHeaders = []string{"Content-Type", "Authorization", "X-Request-Id"}
)

const defaultMaxAge = 600

func Middleware(opts Options) func(http.Handler) http.Handler {
	cfg := normalize(opts)
	allowAll := contains(cfg.AllowedOrigins, "*")
	if allowAll && cfg.AllowCredentials {
		panic("cors: AllowCredentials=true is incompatible with '*' origin")
	}

	methods := strings.Join(cfg.AllowedMethods, ", ")
	headers := strings.Join(cfg.AllowedHeaders, ", ")
	maxAge := strconv.Itoa(cfg.MaxAge)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")

			if origin == "" {
				next.ServeHTTP(w, r)
				return
			}

			if !originAllowed(origin, cfg.AllowedOrigins, allowAll) {
				if r.Method == http.MethodOptions {
					writeForbidden(w, r)
					return
				}
				writeForbidden(w, r)
				return
			}

			h := w.Header()
			if allowAll && !cfg.AllowCredentials {
				h.Set("Access-Control-Allow-Origin", "*")
			} else {
				h.Set("Access-Control-Allow-Origin", origin)
				h.Add("Vary", "Origin")
			}
			if cfg.AllowCredentials {
				h.Set("Access-Control-Allow-Credentials", "true")
			}

			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				h.Set("Access-Control-Allow-Methods", methods)
				h.Set("Access-Control-Allow-Headers", headers)
				h.Set("Access-Control-Max-Age", maxAge)
				h.Add("Vary", "Access-Control-Request-Method")
				h.Add("Vary", "Access-Control-Request-Headers")
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func DefaultMiddleware() func(http.Handler) http.Handler {
	return Middleware(Options{
		AllowedOrigins:   parseOrigins(os.Getenv(EnvAllowOrigins)),
		AllowCredentials: true,
	})
}

func normalize(opts Options) Options {
	if len(opts.AllowedOrigins) == 0 {
		opts.AllowedOrigins = []string{"http://localhost:5173"}
	}
	if len(opts.AllowedMethods) == 0 {
		opts.AllowedMethods = defaultMethods
	}
	if len(opts.AllowedHeaders) == 0 {
		opts.AllowedHeaders = defaultHeaders
	}
	if opts.MaxAge <= 0 {
		opts.MaxAge = defaultMaxAge
	}
	return opts
}

func parseOrigins(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func originAllowed(origin string, allowed []string, allowAll bool) bool {
	if allowAll {
		return true
	}
	return contains(allowed, origin)
}

func contains(list []string, target string) bool {
	for _, v := range list {
		if v == target {
			return true
		}
	}
	return false
}

func writeForbidden(w http.ResponseWriter, r *http.Request) {
	err := apperr.Forbidden("origin not allowed")
	apperr.H(func(http.ResponseWriter, *http.Request) error {
		return err
	}).ServeHTTP(w, r)
}
