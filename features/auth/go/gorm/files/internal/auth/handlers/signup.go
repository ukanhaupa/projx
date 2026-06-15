package authhandlers

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth/mailer"
	authmodels "projx.local/go/internal/auth/models"
	authservice "projx.local/go/internal/auth/service"
)

type signupRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Name     string `json:"name" validate:"required,min=1"`
	Password string `json:"password" validate:"required,min=8"`
}

type signupResponse struct {
	UserID       string `json:"user_id"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

const emailVerifyTTL = 24 * time.Hour

func (d *Deps) signup(w http.ResponseWriter, r *http.Request) {
	var body signupRequest
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

	var existing authmodels.User
	err := d.DB.WithContext(ctx).Where("email = ?", email).First(&existing).Error
	if err == nil {
		apperr.WriteError(w, r, apperr.Conflict("an account with this email already exists"))
		return
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		apperr.WriteError(w, r, err)
		return
	}

	hash, err := authservice.HashPassword(body.Password)
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	var userCount int64
	if err := d.DB.WithContext(ctx).Model(&authmodels.User{}).Count(&userCount).Error; err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	role := "user"
	if userCount == 0 {
		role = "admin"
	}

	user := &authmodels.User{
		Email:        email,
		Name:         body.Name,
		PasswordHash: hash,
		Role:         role,
	}
	if err := d.DB.WithContext(ctx).Create(user).Error; err != nil {
		apperr.WriteError(w, r, apperr.FromDB(err, "user"))
		return
	}

	issued, err := d.Sessions.Issue(ctx, authservice.IssueArgs{
		User:      user,
		IPAddress: clientIP(r),
		UserAgent: userAgent(r),
	})
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	raw, err := authservice.RandomToken()
	if err == nil {
		_ = d.DB.WithContext(ctx).Create(&authmodels.VerificationToken{
			UserID:    user.ID,
			Kind:      authmodels.TokenKindEmailVerify,
			TokenHash: authservice.HashToken(raw),
			ExpiresAt: time.Now().UTC().Add(emailVerifyTTL),
		}).Error
		_ = d.Mailer.SendVerification(user.Email, mailer.BuildVerificationLink(raw))
	}

	writeJSON(w, http.StatusCreated, signupResponse{
		UserID:       user.ID,
		AccessToken:  issued.AccessToken,
		RefreshToken: issued.RefreshToken,
	})
}
