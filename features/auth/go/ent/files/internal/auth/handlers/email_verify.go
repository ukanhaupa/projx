package handlers

import (
	"errors"
	"net/http"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth/mailer"
	authservice "projx.local/go/internal/auth/service"
)

type verifyEmailReq struct {
	Token string `json:"token"`
}

func (d *Deps) VerifyEmail(w http.ResponseWriter, r *http.Request) error {
	var body verifyEmailReq
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if body.Token == "" {
		return apperr.Validation("token is required")
	}
	ctx := r.Context()
	rec, err := d.Service.FindActiveEmailVerify(ctx, authservice.HashToken(body.Token))
	if err != nil {
		return err
	}
	if err := d.Service.MarkEmailVerified(ctx, rec.UserID, rec.ID); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"verified": true})
}

type resendVerificationReq struct {
	Email string `json:"email"`
}

func (d *Deps) ResendVerification(w http.ResponseWriter, r *http.Request) error {
	var body resendVerificationReq
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if !validEmail(body.Email) {
		return apperr.Validation("email must be a valid email address")
	}
	ctx := r.Context()
	u, err := d.Service.FindUserByEmail(ctx, normalizeEmail(body.Email))
	if err != nil {
		var ae apperr.AppError
		if errors.As(err, &ae) && ae.Status == http.StatusNotFound {
			return writeJSON(w, http.StatusAccepted, map[string]any{"sent": true})
		}
		return err
	}
	if u.EmailVerified {
		return writeJSON(w, http.StatusAccepted, map[string]any{"sent": true})
	}
	raw, err := authservice.RandomToken()
	if err != nil {
		return err
	}
	if _, err := d.Service.CreateEmailVerifyToken(ctx, u.ID, authservice.HashToken(raw), authservice.EmailVerifyTokenTTL); err != nil {
		return err
	}
	if err := d.Mailer.SendVerification(u.Email, mailer.BuildVerificationLink(raw)); err != nil {
		d.Logger.Warn("[auth] resend verification email failed", "error", err.Error())
	}
	return writeJSON(w, http.StatusAccepted, map[string]any{"sent": true})
}
