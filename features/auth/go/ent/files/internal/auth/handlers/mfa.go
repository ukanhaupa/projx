package handlers

import (
	"net/http"
	"strings"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth"
	authservice "projx.local/go/internal/auth/service"
)

type mfaVerifyChallengeReq struct {
	ChallengeToken string `json:"challenge_token"`
	Code           string `json:"code"`
	UseRecovery    bool   `json:"use_recovery"`
}

func (d *Deps) MFAVerifyChallenge(w http.ResponseWriter, r *http.Request) error {
	var body mfaVerifyChallengeReq
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if body.ChallengeToken == "" {
		return apperr.Validation("challenge_token is required")
	}
	if len(strings.TrimSpace(body.Code)) < 6 {
		return apperr.Validation("code is required")
	}

	ctx := r.Context()
	claims, err := d.Service.Signer().VerifyMFAChallenge(ctx, body.ChallengeToken)
	if err != nil {
		return apperr.Unauthorized("Challenge token invalid or expired")
	}
	stage, _ := claims["stage"].(string)
	sub, _ := claims["sub"].(string)
	if stage != "mfa_pending" || sub == "" {
		return apperr.Unauthorized("Challenge token invalid")
	}

	u, err := d.Service.FindUserByID(ctx, sub)
	if err != nil {
		return apperr.Unauthorized("MFA not configured")
	}
	if !u.MfaEnabled || u.MfaSecretEnc == "" {
		return apperr.Unauthorized("MFA not configured")
	}
	if authservice.IsMFALocked(u.MfaLockedUntil) {
		return apperr.AppError{
			Code:   "rate_limited",
			Detail: authservice.FormatLockoutMessage(*u.MfaLockedUntil, "MFA temporarily locked."),
			Status: http.StatusTooManyRequests,
		}
	}

	var success bool
	if body.UseRecovery {
		ok, err := d.Service.ConsumeRecoveryCode(ctx, u.ID, body.Code)
		if err != nil {
			return err
		}
		success = ok
	} else {
		secret, err := d.Service.Cipher().Decrypt(ctx, u.MfaSecretEnc)
		if err != nil {
			return apperr.Unauthorized("MFA not configured")
		}
		success = authservice.VerifyTOTP(body.Code, secret)
	}

	if !success {
		if err := d.Service.RecordMFAFailure(ctx, u); err != nil {
			d.Logger.Warn("[auth] record mfa failure", "error", err.Error())
		}
		return apperr.Unauthorized("Invalid MFA code")
	}

	if err := d.Service.ResetMFACounters(ctx, u.ID); err != nil {
		d.Logger.Warn("[auth] reset mfa counters", "error", err.Error())
	}

	sess, err := d.Service.IssueSession(ctx, u, clientIP(r), r.UserAgent())
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, sess)
}

func (d *Deps) MFAEnroll(w http.ResponseWriter, r *http.Request) error {
	user, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("")
	}
	ctx := r.Context()
	u, err := d.Service.FindUserByID(ctx, user.ID)
	if err != nil {
		return err
	}
	if u.MfaEnabled {
		return apperr.Conflict("MFA is already enabled. Disable it first to re-enroll.")
	}
	secret, err := authservice.GenerateSecret()
	if err != nil {
		return err
	}
	enc, err := d.Service.Cipher().Encrypt(ctx, secret)
	if err != nil {
		return err
	}
	if err := d.Service.BeginMFAEnrollment(ctx, u.ID, enc); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{
		"secret":       secret,
		"otpauth_url":  authservice.BuildOtpauthURL(u.Email, secret),
	})
}

type mfaCodeReq struct {
	Code string `json:"code"`
}

func (d *Deps) MFAEnrollVerify(w http.ResponseWriter, r *http.Request) error {
	user, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("")
	}
	var body mfaCodeReq
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if len(strings.TrimSpace(body.Code)) < 6 {
		return apperr.Validation("code is required")
	}
	ctx := r.Context()
	u, err := d.Service.FindUserByID(ctx, user.ID)
	if err != nil {
		return err
	}
	if u.MfaSecretEnc == "" {
		return apperr.Validation("No pending MFA enrollment. Start enrollment first.")
	}
	if u.MfaEnabled {
		return apperr.Conflict("MFA is already enabled.")
	}
	secret, err := d.Service.Cipher().Decrypt(ctx, u.MfaSecretEnc)
	if err != nil {
		return apperr.Validation("Invalid code. Scan the QR and try again.")
	}
	if !authservice.VerifyTOTP(body.Code, secret) {
		return apperr.Validation("Invalid code. Scan the QR and try again.")
	}
	codes, err := authservice.GenerateRecoveryCodes(authservice.RecoveryCodeCount)
	if err != nil {
		return err
	}
	hashes := make([]string, 0, len(codes))
	for _, code := range codes {
		h, err := authservice.HashPassword(authservice.DenormalizeRecoveryCode(code))
		if err != nil {
			return err
		}
		hashes = append(hashes, h)
	}
	if err := d.Service.ReplaceRecoveryCodes(ctx, u.ID, hashes); err != nil {
		return err
	}
	if err := d.Service.EnableMFA(ctx, u.ID, u.MfaSecretEnc); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"recovery_codes": codes})
}

type mfaDisableReq struct {
	Password    string `json:"password"`
	Code        string `json:"code"`
	UseRecovery bool   `json:"use_recovery"`
}

func (d *Deps) MFADisable(w http.ResponseWriter, r *http.Request) error {
	user, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("")
	}
	var body mfaDisableReq
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if body.Password == "" || body.Code == "" {
		return apperr.Validation("password and code are required")
	}
	ctx := r.Context()
	u, err := d.Service.FindUserByID(ctx, user.ID)
	if err != nil {
		return err
	}
	if !u.MfaEnabled || u.MfaSecretEnc == "" {
		return apperr.Validation("MFA is not enabled.")
	}
	if !authservice.VerifyPassword(body.Password, u.PasswordHash) {
		return apperr.Validation("Invalid password")
	}
	var ok2 bool
	if body.UseRecovery {
		consumed, err := d.Service.ConsumeRecoveryCode(ctx, u.ID, body.Code)
		if err != nil {
			return err
		}
		ok2 = consumed
	} else {
		secret, err := d.Service.Cipher().Decrypt(ctx, u.MfaSecretEnc)
		if err != nil {
			return apperr.Validation("Invalid MFA code")
		}
		ok2 = authservice.VerifyTOTP(body.Code, secret)
	}
	if !ok2 {
		if err := d.Service.RecordMFAFailure(ctx, u); err != nil {
			d.Logger.Warn("[auth] record mfa failure", "error", err.Error())
		}
		return apperr.Validation("Invalid MFA code")
	}
	if err := d.Service.DisableMFA(ctx, u.ID); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (d *Deps) MFARegenerateRecoveryCodes(w http.ResponseWriter, r *http.Request) error {
	user, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("")
	}
	var body mfaCodeReq
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if len(strings.TrimSpace(body.Code)) < 6 {
		return apperr.Validation("code is required")
	}
	ctx := r.Context()
	u, err := d.Service.FindUserByID(ctx, user.ID)
	if err != nil {
		return err
	}
	if !u.MfaEnabled || u.MfaSecretEnc == "" {
		return apperr.Validation("MFA is not enabled.")
	}
	if authservice.IsMFALocked(u.MfaLockedUntil) {
		return apperr.AppError{Code: "rate_limited", Detail: "MFA temporarily locked.", Status: http.StatusTooManyRequests}
	}
	secret, err := d.Service.Cipher().Decrypt(ctx, u.MfaSecretEnc)
	if err != nil {
		return apperr.Validation("Invalid MFA code")
	}
	if !authservice.VerifyTOTP(body.Code, secret) {
		if err := d.Service.RecordMFAFailure(ctx, u); err != nil {
			d.Logger.Warn("[auth] record mfa failure", "error", err.Error())
		}
		return apperr.Validation("Invalid MFA code")
	}
	codes, err := authservice.GenerateRecoveryCodes(authservice.RecoveryCodeCount)
	if err != nil {
		return err
	}
	hashes := make([]string, 0, len(codes))
	for _, code := range codes {
		h, err := authservice.HashPassword(authservice.DenormalizeRecoveryCode(code))
		if err != nil {
			return err
		}
		hashes = append(hashes, h)
	}
	if err := d.Service.ReplaceRecoveryCodes(ctx, u.ID, hashes); err != nil {
		return err
	}
	if err := d.Service.ResetMFACounters(ctx, u.ID); err != nil {
		d.Logger.Warn("[auth] reset mfa counters", "error", err.Error())
	}
	return writeJSON(w, http.StatusOK, map[string]any{"recovery_codes": codes})
}

