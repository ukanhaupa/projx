package authhandlers

import (
	"errors"
	"net/http"
	"strings"

	"gorm.io/gorm"

	"projx.local/go/internal/apperr"
	authmodels "projx.local/go/internal/auth/models"
	authservice "projx.local/go/internal/auth/service"
)

type loginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
	MFACode  string `json:"mfa_code"`
}

type loginResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

type loginMFAResponse struct {
	MFARequired    bool   `json:"mfa_required"`
	ChallengeToken string `json:"challenge_token"`
	Email          string `json:"email"`
}

func (d *Deps) login(w http.ResponseWriter, r *http.Request) {
	var body loginRequest
	if err := decode(r, &body); err != nil {
		apperr.WriteError(w, r, apperr.Validation("invalid request body"))
		return
	}
	if err := validate(d, body); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	email := strings.ToLower(strings.TrimSpace(body.Email))
	ctx := r.Context()

	var user authmodels.User
	err := d.DB.WithContext(ctx).Where("email = ?", email).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apperr.WriteError(w, r, apperr.Unauthorized("invalid credentials"))
		return
	}
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	if authservice.IsAccountLocked(&user) {
		apperr.WriteError(w, r, apperr.AppError{Code: "too_many_requests", Detail: "too many failed attempts; try again later", Status: http.StatusTooManyRequests})
		return
	}

	if !authservice.VerifyPassword(body.Password, user.PasswordHash) {
		_ = authservice.RegisterFailedLogin(d.DB, ctx, &user)
		apperr.WriteError(w, r, apperr.Unauthorized("invalid credentials"))
		return
	}

	if err := authservice.ResetLoginCounters(d.DB, ctx, user.ID); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	if user.MFAEnabled {
		if authservice.IsMFALocked(user.MFALockedUntil) {
			apperr.WriteError(w, r, apperr.AppError{Code: "too_many_requests", Detail: "MFA temporarily locked", Status: http.StatusTooManyRequests})
			return
		}
		if body.MFACode == "" {
			challenge, err := d.Signer.SignMFAChallenge(ctx, user.ID)
			if err != nil {
				apperr.WriteError(w, r, err)
				return
			}
			writeJSON(w, http.StatusOK, loginMFAResponse{MFARequired: true, ChallengeToken: challenge, Email: user.Email})
			return
		}
		secret, err := authservice.DecodeMFASecret(user.MFASecretEnc)
		if err != nil || !authservice.VerifyTOTP(body.MFACode, secret) {
			_ = authservice.RegisterMFAFailure(d.DB, ctx, &user)
			apperr.WriteError(w, r, apperr.Unauthorized("invalid mfa code"))
			return
		}
		_ = authservice.ResetMFACounters(d.DB, ctx, user.ID)
	}

	issued, err := d.Sessions.Issue(ctx, authservice.IssueArgs{
		User:      &user,
		IPAddress: clientIP(r),
		UserAgent: userAgent(r),
	})
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, loginResponse{AccessToken: issued.AccessToken, RefreshToken: issued.RefreshToken})
}
