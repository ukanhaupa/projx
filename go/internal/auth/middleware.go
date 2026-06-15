package auth

import (
	"context"
	"net/http"
	"strings"

	"projx.local/go/internal/apperr"
)

type AuthUser struct {
	ID          string
	Email       string
	Role        string
	Permissions []string
	SID         string
}

type ctxKey int

const authUserKey ctxKey = iota

func extractBearer(header string) string {
	if header == "" {
		return ""
	}
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func toAuthUser(c *Claims) *AuthUser {
	perms := c.Permissions
	if perms == nil {
		perms = []string{}
	}
	return &AuthUser{
		ID:          c.Subject,
		Email:       c.Email,
		Role:        c.Role,
		Permissions: perms,
		SID:         c.SID,
	}
}

func Authenticate(v *Verifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractBearer(r.Header.Get("Authorization"))
			if token == "" {
				next.ServeHTTP(w, r)
				return
			}
			claims, err := v.VerifyToken(r.Context(), token)
			if err != nil {
				apperr.WriteError(w, r, err)
				return
			}
			ctx := context.WithValue(r.Context(), authUserKey, toAuthUser(claims))
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func AuthzRequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := FromContext(r.Context()); !ok {
			apperr.WriteError(w, r, apperr.Unauthorized("authentication required"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func AuthzRequireRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := FromContext(r.Context())
			if !ok {
				apperr.WriteError(w, r, apperr.Unauthorized("authentication required"))
				return
			}
			for _, role := range roles {
				if user.Role == role {
					next.ServeHTTP(w, r)
					return
				}
			}
			apperr.WriteError(w, r, apperr.Forbidden("insufficient role"))
		})
	}
}

func FromContext(ctx context.Context) (*AuthUser, bool) {
	v, ok := ctx.Value(authUserKey).(*AuthUser)
	if !ok || v == nil {
		return nil, false
	}
	return v, true
}
