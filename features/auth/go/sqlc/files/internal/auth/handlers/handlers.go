package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth/mailer"
	authservice "projx.local/go/internal/auth/service"
	"projx.local/go/internal/httputil"
)

const (
	LoginMaxAttempts    = 5
	LoginLockoutMinutes = 15
	ResetTokenTTL       = 30 * time.Minute
	VerifyTokenTTL      = 24 * time.Hour
)

type Handler struct {
	svc    *authservice.Service
	mailer *mailer.Mailer
}

func New(svc *authservice.Service, m *mailer.Mailer) *Handler {
	return &Handler{svc: svc, mailer: m}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/signup", apperr.H(h.Signup).ServeHTTP)
	r.Post("/login", apperr.H(h.Login).ServeHTTP)
	r.Post("/refresh", apperr.H(h.Refresh).ServeHTTP)
	r.Post("/logout", apperr.H(h.Logout).ServeHTTP)
	r.Post("/change-password", apperr.H(h.ChangePassword).ServeHTTP)
	r.Get("/me", apperr.H(h.Me).ServeHTTP)
	r.Get("/sessions", apperr.H(h.ListSessions).ServeHTTP)

	r.Post("/forgot-password", apperr.H(h.ForgotPassword).ServeHTTP)
	r.Post("/reset-password", apperr.H(h.ResetPassword).ServeHTTP)
	r.Post("/verify-email", apperr.H(h.VerifyEmail).ServeHTTP)
	r.Post("/resend-verification", apperr.H(h.ResendVerification).ServeHTTP)

	r.Post("/mfa/enroll", apperr.H(h.MFAEnroll).ServeHTTP)
	r.Post("/mfa/enroll/verify", apperr.H(h.MFAEnrollVerify).ServeHTTP)
	r.Post("/mfa/verify-challenge", apperr.H(h.MFAVerifyChallenge).ServeHTTP)
	r.Post("/mfa/disable", apperr.H(h.MFADisable).ServeHTTP)
	r.Post("/mfa/recovery-codes/regenerate", apperr.H(h.MFARegenerate).ServeHTTP)
	return r
}

func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return apperr.Validation("invalid JSON body")
	}
	return nil
}

func clientIP(r *http.Request) string {
	if h := r.Header.Get("X-Forwarded-For"); h != "" {
		return strings.TrimSpace(strings.Split(h, ",")[0])
	}
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i >= 0 {
		return host[:i]
	}
	return host
}

func userAgent(r *http.Request) string { return r.Header.Get("User-Agent") }

func writeJSON(w http.ResponseWriter, status int, body any) error {
	return httputil.WriteJSON(w, status, body)
}

func okStatus() map[string]any { return map[string]any{"status": "ok"} }
