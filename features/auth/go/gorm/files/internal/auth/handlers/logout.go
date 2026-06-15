package authhandlers

import (
	"net/http"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth"
)

func (d *Deps) logout(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.FromContext(r.Context())
	if !ok {
		apperr.WriteError(w, r, apperr.Unauthorized("authentication required"))
		return
	}
	if user.SID == "" {
		if err := d.Sessions.RevokeAllForUser(r.Context(), user.ID); err != nil {
			apperr.WriteError(w, r, err)
			return
		}
	} else {
		if err := d.Sessions.RevokeSession(r.Context(), user.ID, user.SID); err != nil {
			apperr.WriteError(w, r, err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}
