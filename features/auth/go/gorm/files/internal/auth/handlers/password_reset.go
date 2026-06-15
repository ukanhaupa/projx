package authhandlers

import (
	"crypto/subtle"
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

type passwordResetRequestBody struct {
	Email string `json:"email" validate:"required,email"`
}

type passwordResetConfirmBody struct {
	Token       string `json:"token" validate:"required"`
	NewPassword string `json:"new_password" validate:"required,min=8"`
}

const passwordResetTTL = 30 * time.Minute

func (d *Deps) passwordResetRequest(w http.ResponseWriter, r *http.Request) {
	var body passwordResetRequestBody
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
	dummy := make([]byte, 32)
	subtle.ConstantTimeCompare(dummy, dummy)

	if errors.Is(err, gorm.ErrRecordNotFound) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	raw, err := authservice.RandomToken()
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	row := &authmodels.VerificationToken{
		UserID:    user.ID,
		Kind:      authmodels.TokenKindPasswordReset,
		TokenHash: authservice.HashToken(raw),
		ExpiresAt: time.Now().UTC().Add(passwordResetTTL),
	}
	if err := d.DB.WithContext(ctx).Create(row).Error; err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	_ = d.Mailer.SendPasswordReset(user.Email, mailer.BuildResetLink(raw))
	w.WriteHeader(http.StatusNoContent)
}

func (d *Deps) passwordResetConfirm(w http.ResponseWriter, r *http.Request) {
	var body passwordResetConfirmBody
	if err := decode(r, &body); err != nil {
		apperr.WriteError(w, r, apperr.Validation("invalid request body"))
		return
	}
	if err := validate(d, body); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	ctx := r.Context()
	hash := authservice.HashToken(body.Token)
	var record authmodels.VerificationToken
	err := d.DB.WithContext(ctx).
		Where("token_hash = ? AND kind = ? AND consumed_at IS NULL AND expires_at > ?", hash, authmodels.TokenKindPasswordReset, time.Now().UTC()).
		First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apperr.WriteError(w, r, apperr.Validation("invalid or expired reset token"))
		return
	}
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	newHash, err := authservice.HashPassword(body.NewPassword)
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	now := time.Now().UTC()
	err = d.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&authmodels.User{}).Where("id = ?", record.UserID).Update("password_hash", newHash).Error; err != nil {
			return err
		}
		if err := tx.Model(&authmodels.VerificationToken{}).Where("id = ?", record.ID).Update("consumed_at", now).Error; err != nil {
			return err
		}
		return tx.Model(&authmodels.RefreshToken{}).
			Where("user_id = ? AND revoked_at IS NULL", record.UserID).
			Update("revoked_at", now).Error
	})
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
