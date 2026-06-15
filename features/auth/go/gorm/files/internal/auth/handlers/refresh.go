package authhandlers

import (
	"errors"
	"net/http"

	"projx.local/go/internal/apperr"
	authservice "projx.local/go/internal/auth/service"
)

type refreshRequest struct {
	RefreshToken string `json:"refresh_token" validate:"required"`
}

type refreshResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

func (d *Deps) refresh(w http.ResponseWriter, r *http.Request) {
	var body refreshRequest
	if err := decode(r, &body); err != nil {
		apperr.WriteError(w, r, apperr.Validation("invalid request body"))
		return
	}
	if err := validate(d, body); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	issued, err := d.Sessions.Rotate(r.Context(), authservice.RotateArgs{
		RefreshToken: body.RefreshToken,
		IPAddress:    clientIP(r),
		UserAgent:    userAgent(r),
	})
	if err != nil {
		switch {
		case errors.Is(err, authservice.ErrReplayDetected):
			apperr.WriteError(w, r, apperr.Unauthorized("token_replay_detected"))
		default:
			apperr.WriteError(w, r, apperr.Unauthorized("invalid refresh token"))
		}
		return
	}
	writeJSON(w, http.StatusOK, refreshResponse{AccessToken: issued.AccessToken, RefreshToken: issued.RefreshToken})
}
