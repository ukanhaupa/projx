package authhandlers

import (
	"errors"
	"net/http"
	"time"

	"gorm.io/gorm"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth"
	"projx.local/go/internal/auth/mailer"
	authmodels "projx.local/go/internal/auth/models"
	authservice "projx.local/go/internal/auth/service"
)

type emailVerifyConfirmBody struct {
	Token string `json:"token" validate:"required"`
}

func (d *Deps) emailVerifyRequest(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.FromContext(r.Context())
	if !ok {
		apperr.WriteError(w, r, apperr.Unauthorized("authentication required"))
		return
	}
	ctx := r.Context()
	var u authmodels.User
	if err := d.DB.WithContext(ctx).Where("id = ?", user.ID).First(&u).Error; err != nil {
		apperr.WriteError(w, r, apperr.NotFound("user"))
		return
	}
	if u.EmailVerified {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	raw, err := authservice.RandomToken()
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	if err := d.DB.WithContext(ctx).Create(&authmodels.VerificationToken{
		UserID:    u.ID,
		Kind:      authmodels.TokenKindEmailVerify,
		TokenHash: authservice.HashToken(raw),
		ExpiresAt: time.Now().UTC().Add(emailVerifyTTL),
	}).Error; err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	_ = d.Mailer.SendVerification(u.Email, mailer.BuildVerificationLink(raw))
	w.WriteHeader(http.StatusNoContent)
}

func (d *Deps) emailVerifyConfirm(w http.ResponseWriter, r *http.Request) {
	var body emailVerifyConfirmBody
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
		Where("token_hash = ? AND kind = ? AND consumed_at IS NULL AND expires_at > ?", hash, authmodels.TokenKindEmailVerify, time.Now().UTC()).
		First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apperr.WriteError(w, r, apperr.Validation("invalid or expired verification token"))
		return
	}
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	now := time.Now().UTC()
	err = d.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&authmodels.User{}).Where("id = ?", record.UserID).
			Updates(map[string]any{"email_verified": true, "email_verified_at": now}).Error; err != nil {
			return err
		}
		return tx.Model(&authmodels.VerificationToken{}).Where("id = ?", record.ID).Update("consumed_at", now).Error
	})
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
