package web

import (
	"context"
	"net/http"
	"time"

	"adminpanel/internal/auth"
)

const (
	schemaCookie  = "admin_schema"
	defaultSchema = "public"
)

func contextWithSession(r *http.Request, s *auth.Session) context.Context {
	return context.WithValue(r.Context(), userKey, s)
}

func sessionFrom(r *http.Request) *auth.Session {
	if s, ok := r.Context().Value(userKey).(*auth.Session); ok {
		return s
	}
	return nil
}

func currentUser(r *http.Request) *auth.AdminUser {
	if s := sessionFrom(r); s != nil {
		return s.User
	}
	return nil
}

func userEmail(r *http.Request) string {
	if u := currentUser(r); u != nil {
		return u.Email
	}
	return ""
}

func canWrite(r *http.Request) bool {
	if u := currentUser(r); u != nil {
		return u.CanWrite()
	}
	return false
}

func inWriteMode(r *http.Request) bool {
	if s := sessionFrom(r); s != nil {
		return s.InWriteMode
	}
	return false
}

func writeExpires(r *http.Request) time.Time {
	if s := sessionFrom(r); s != nil {
		return s.WriteExpires
	}
	return time.Time{}
}

func sessionToken(r *http.Request) string {
	if c, err := r.Cookie(sessionCookie); err == nil {
		return c.Value
	}
	return ""
}

func currentSchema(r *http.Request) string {
	if c, err := r.Cookie(schemaCookie); err == nil && c.Value != "" {
		return c.Value
	}
	return defaultSchema
}
