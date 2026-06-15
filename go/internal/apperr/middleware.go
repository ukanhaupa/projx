package apperr

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"runtime/debug"

	"projx.local/go/internal/requestid"
)

type envelope struct {
	Detail    string `json:"detail"`
	RequestID string `json:"request_id"`
}

type HandlerFunc func(http.ResponseWriter, *http.Request) error

func H(fn HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			writeError(w, r, err)
		}
	})
}

func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				rid := requestid.FromContext(r.Context())
				slog.Error("panic recovered",
					"request_id", rid,
					"panic", rec,
					"stack", string(debug.Stack()),
				)
				writeEnvelope(w, http.StatusInternalServerError, "internal server error", rid)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	writeError(w, r, err)
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	rid := requestid.FromContext(r.Context())
	status := StatusOf(err)
	detail := DetailOf(err)
	if status >= 500 {
		slog.Error("request failed", "request_id", rid, "error", err.Error())
	} else {
		slog.Warn("request rejected", "request_id", rid, "status", status, "error", err.Error())
	}
	writeEnvelope(w, status, detail, rid)
}

func writeEnvelope(w http.ResponseWriter, status int, detail, rid string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{Detail: detail, RequestID: rid})
}
