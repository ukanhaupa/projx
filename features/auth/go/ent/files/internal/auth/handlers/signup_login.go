package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth/mailer"
	authservice "projx.local/go/internal/auth/service"
)

type signupReq struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

func (d *Deps) Signup(w http.ResponseWriter, r *http.Request) error {
	var body signupReq
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if !validEmail(body.Email) {
		return apperr.Validation("email must be a valid email address")
	}
	if len(body.Password) < 8 {
		return apperr.Validation("password must be at least 8 characters")
	}
	if body.Name == "" {
		return apperr.Validation("name is required")
	}

	email := normalizeEmail(body.Email)
	ctx := r.Context()

	if _, err := d.Service.FindUserByEmail(ctx, email); err == nil {
		return apperr.Conflict("An account with this email already exists.")
	} else {
		var ae apperr.AppError
		if !errors.As(err, &ae) || ae.Status != http.StatusNotFound {
			return err
		}
	}

	hash, err := authservice.HashPassword(body.Password)
	if err != nil {
		return err
	}

	count, err := d.Service.CountUsers(ctx)
	if err != nil {
		return err
	}
	role := "user"
	if count == 0 {
		role = "admin"
	}

	u, err := d.Service.CreateUser(ctx, email, body.Name, hash, role)
	if err != nil {
		return err
	}

	session, err := d.Service.IssueSession(ctx, u, clientIP(r), r.UserAgent())
	if err != nil {
		return err
	}

	go func(userID string) {
		bgCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := d.sendInitialVerification(bgCtx, userID); err != nil {
			d.Logger.Error("[auth] initial verification failed", "user_id", userID, "error", err.Error())
		}
	}(u.ID)

	return writeJSON(w, http.StatusCreated, session)
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (d *Deps) Login(w http.ResponseWriter, r *http.Request) error {
	var body loginReq
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if !validEmail(body.Email) {
		return apperr.Validation("email must be a valid email address")
	}
	if body.Password == "" {
		return apperr.Validation("password is required")
	}

	ctx := r.Context()
	u, err := d.Service.FindUserByEmail(ctx, normalizeEmail(body.Email))
	if err != nil {
		var ae apperr.AppError
		if errors.As(err, &ae) && ae.Status == http.StatusNotFound {
			return apperr.Unauthorized("Invalid credentials")
		}
		return err
	}

	if u.LockedUntil != nil && u.LockedUntil.After(time.Now()) {
		return apperr.AppError{
			Code:   "rate_limited",
			Detail: authservice.FormatLockoutMessage(*u.LockedUntil, "Too many failed attempts."),
			Status: http.StatusTooManyRequests,
		}
	}

	if u.PasswordHash == "" || !authservice.VerifyPassword(body.Password, u.PasswordHash) {
		if u.PasswordHash != "" {
			if err := d.Service.RecordFailedLogin(ctx, u); err != nil {
				d.Logger.Warn("[auth] record failed login", "error", err.Error())
			}
		}
		return apperr.Unauthorized("Invalid credentials")
	}

	fresh, err := d.Service.ResetLoginCounters(ctx, u.ID)
	if err != nil {
		return err
	}

	if fresh.MfaEnabled {
		if authservice.IsMFALocked(fresh.MfaLockedUntil) {
			return apperr.AppError{
				Code:   "rate_limited",
				Detail: authservice.FormatLockoutMessage(*fresh.MfaLockedUntil, "MFA temporarily locked."),
				Status: http.StatusTooManyRequests,
			}
		}
		challenge, err := d.Service.Signer().SignMFAChallenge(ctx, fresh.ID)
		if err != nil {
			return err
		}
		return writeJSON(w, http.StatusOK, map[string]any{
			"mfa_required":    true,
			"challenge_token": challenge,
			"email":           fresh.Email,
		})
	}

	session, err := d.Service.IssueSession(ctx, fresh, clientIP(r), r.UserAgent())
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, session)
}

func (d *Deps) sendInitialVerification(ctx context.Context, userID string) error {
	u, err := d.Service.FindUserByID(ctx, userID)
	if err != nil {
		var ae apperr.AppError
		if errors.As(err, &ae) && ae.Status == http.StatusNotFound {
			return nil
		}
		return err
	}
	if u.EmailVerified {
		return nil
	}
	raw, err := authservice.RandomToken()
	if err != nil {
		return err
	}
	if _, err := d.Service.CreateEmailVerifyToken(ctx, u.ID, authservice.HashToken(raw), authservice.EmailVerifyTokenTTL); err != nil {
		return err
	}
	link := mailer.BuildVerificationLink(raw)
	return d.Mailer.SendVerification(u.Email, link)
}
