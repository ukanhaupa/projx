package authhandlers

import (
	"errors"
	"net/http"
	"time"

	"gorm.io/gorm"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth"
	authmodels "projx.local/go/internal/auth/models"
	authservice "projx.local/go/internal/auth/service"
)

type mfaEnrollResponse struct {
	Secret        string   `json:"secret"`
	QRCodeURL     string   `json:"qrcode_url"`
	RecoveryCodes []string `json:"recovery_codes"`
}

type mfaVerifyBody struct {
	Code string `json:"code" validate:"required,min=6,max=10"`
}

type mfaDisableBody struct {
	Password string `json:"password" validate:"required"`
}

func (d *Deps) mfaEnroll(w http.ResponseWriter, r *http.Request) {
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
	if u.MFAEnabled {
		apperr.WriteError(w, r, apperr.Conflict("MFA already enabled"))
		return
	}
	secret, err := authservice.GenerateMFASecret()
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	codes, err := authservice.GenerateRecoveryCodes()
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	hashes, err := authservice.HashRecoveryCodes(codes)
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	enc, err := authservice.EncodeMFASecret(secret)
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	encHashes, err := authservice.EncodeRecoveryHashes(hashes)
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	updates := map[string]any{
		"mfa_secret_enc":         enc,
		"mfa_recovery_codes_enc": encHashes,
		"mfa_verified_at":        nil,
	}
	if err := d.DB.WithContext(ctx).Model(&authmodels.User{}).Where("id = ?", u.ID).Updates(updates).Error; err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, mfaEnrollResponse{
		Secret:        secret,
		QRCodeURL:     authservice.BuildOTPAuthURL(u.Email, secret),
		RecoveryCodes: codes,
	})
}

func (d *Deps) mfaVerify(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.FromContext(r.Context())
	if !ok {
		apperr.WriteError(w, r, apperr.Unauthorized("authentication required"))
		return
	}
	var body mfaVerifyBody
	if err := decode(r, &body); err != nil {
		apperr.WriteError(w, r, apperr.Validation("invalid request body"))
		return
	}
	if err := validate(d, body); err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	ctx := r.Context()
	var u authmodels.User
	if err := d.DB.WithContext(ctx).Where("id = ?", user.ID).First(&u).Error; err != nil {
		apperr.WriteError(w, r, apperr.NotFound("user"))
		return
	}
	if u.MFASecretEnc == "" {
		apperr.WriteError(w, r, apperr.Validation("MFA not pending enrollment"))
		return
	}
	secret, err := authservice.DecodeMFASecret(u.MFASecretEnc)
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	if !authservice.VerifyTOTP(body.Code, secret) {
		_ = authservice.RegisterMFAFailure(d.DB, ctx, &u)
		apperr.WriteError(w, r, apperr.Validation("invalid mfa code"))
		return
	}
	now := time.Now().UTC()
	if err := d.DB.WithContext(ctx).Model(&authmodels.User{}).Where("id = ?", u.ID).
		Updates(map[string]any{"mfa_enabled": true, "mfa_verified_at": now, "mfa_failed_count": 0, "mfa_locked_until": nil}).Error; err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d *Deps) mfaDisable(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.FromContext(r.Context())
	if !ok {
		apperr.WriteError(w, r, apperr.Unauthorized("authentication required"))
		return
	}
	var body mfaDisableBody
	if err := decode(r, &body); err != nil {
		apperr.WriteError(w, r, apperr.Validation("invalid request body"))
		return
	}
	if err := validate(d, body); err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	ctx := r.Context()
	var u authmodels.User
	if err := d.DB.WithContext(ctx).Where("id = ?", user.ID).First(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			apperr.WriteError(w, r, apperr.NotFound("user"))
			return
		}
		apperr.WriteError(w, r, err)
		return
	}
	if !u.MFAEnabled {
		apperr.WriteError(w, r, apperr.Validation("MFA not enabled"))
		return
	}
	if !authservice.VerifyPassword(body.Password, u.PasswordHash) {
		apperr.WriteError(w, r, apperr.Validation("invalid password"))
		return
	}
	if err := d.DB.WithContext(ctx).Model(&authmodels.User{}).Where("id = ?", u.ID).
		Updates(map[string]any{
			"mfa_enabled":            false,
			"mfa_secret_enc":         "",
			"mfa_recovery_codes_enc": "",
			"mfa_verified_at":        nil,
			"mfa_failed_count":       0,
			"mfa_locked_until":       nil,
		}).Error; err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
