package web

import (
	"context"
	"net/http"

	"adminpanel/internal/auth"
)

func contextWithUser(r *http.Request, u *auth.AdminUser) context.Context {
	return context.WithValue(r.Context(), userKey, u)
}

func userEmail(r *http.Request) string {
	if u, ok := r.Context().Value(userKey).(*auth.AdminUser); ok {
		return u.Email
	}
	return ""
}
