package handlers

import (
	"errors"
	"net/http"
	"os"
	"strings"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth"
	"projx.local/go/internal/auth/mailer"
	authservice "projx.local/go/internal/auth/service"
)

type changePasswordReq struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (d *Deps) ChangePassword(w http.ResponseWriter, r *http.Request) error {
	user, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("")
	}
	var body changePasswordReq
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if len(body.NewPassword) < 8 {
		return apperr.Validation("new_password must be at least 8 characters")
	}
	ctx := r.Context()
	u, err := d.Service.FindUserByID(ctx, user.ID)
	if err != nil {
		return err
	}
	if u.PasswordHash == "" || !authservice.VerifyPassword(body.CurrentPassword, u.PasswordHash) {
		return apperr.Validation("Invalid password")
	}
	hash, err := authservice.HashPassword(body.NewPassword)
	if err != nil {
		return err
	}
	if err := d.Service.UpdatePasswordHash(ctx, u.ID, hash); err != nil {
		return err
	}
	if err := d.Service.RevokeOtherSessions(ctx, u.ID, user.SID); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type forgotPasswordReq struct {
	Email string `json:"email"`
}

func (d *Deps) ForgotPassword(w http.ResponseWriter, r *http.Request) error {
	var body forgotPasswordReq
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if !validEmail(body.Email) {
		return apperr.Validation("email must be a valid email address")
	}
	ctx := r.Context()
	email := normalizeEmail(body.Email)

	response := map[string]any{
		"message": "If the account exists, a password reset link has been generated.",
	}

	u, err := d.Service.FindUserByEmail(ctx, email)
	if err != nil {
		var ae apperr.AppError
		if errors.As(err, &ae) && ae.Status == http.StatusNotFound {
			return writeJSON(w, http.StatusOK, response)
		}
		return err
	}

	raw, err := authservice.RandomToken()
	if err != nil {
		return err
	}
	if _, err := d.Service.CreatePasswordResetToken(ctx, u.ID, authservice.HashToken(raw), authservice.ResetTokenTTL); err != nil {
		return err
	}
	link := mailer.BuildResetLink(raw)
	if err := d.Mailer.SendPasswordReset(u.Email, link); err != nil {
		d.Logger.Warn("[auth] password reset email failed", "error", err.Error())
	}

	if debugAuthTokens() {
		response["reset_token"] = raw
	}
	return writeJSON(w, http.StatusOK, response)
}

type resetPasswordReq struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

func (d *Deps) ResetPassword(w http.ResponseWriter, r *http.Request) error {
	var body resetPasswordReq
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if body.Token == "" {
		return apperr.Validation("token is required")
	}
	if len(body.NewPassword) < 8 {
		return apperr.Validation("new_password must be at least 8 characters")
	}
	ctx := r.Context()
	tokenHash := authservice.HashToken(body.Token)
	rec, err := d.Service.FindActivePasswordReset(ctx, tokenHash)
	if err != nil {
		return err
	}
	hash, err := authservice.HashPassword(body.NewPassword)
	if err != nil {
		return err
	}
	if err := d.Service.UpdatePasswordHash(ctx, rec.UserID, hash); err != nil {
		return err
	}
	if err := d.Service.ConsumePasswordReset(ctx, rec.ID); err != nil {
		return err
	}
	if err := d.Service.RevokeAllUserSessions(ctx, rec.UserID); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func debugAuthTokens() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("AUTH_DEBUG_TOKENS")), "true")
}
