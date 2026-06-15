package handlers

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/httputil"
)

func decodeJSON(r *http.Request, target any) error {
	if r.Body == nil {
		return apperr.Validation("request body is required")
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		return apperr.Validation("invalid JSON body")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, body any) error {
	return httputil.WriteJSON(w, status, body)
}

func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		parts := strings.Split(v, ",")
		return strings.TrimSpace(parts[0])
	}
	if v := r.Header.Get("X-Real-IP"); v != "" {
		return strings.TrimSpace(v)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func validEmail(email string) bool {
	if email == "" {
		return false
	}
	at := strings.Index(email, "@")
	if at < 1 || at == len(email)-1 {
		return false
	}
	dot := strings.LastIndex(email, ".")
	return dot > at+1 && dot < len(email)-1
}
