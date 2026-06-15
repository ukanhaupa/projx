package handlers

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth"
	authservice "projx.local/go/internal/auth/service"
	"projx.local/go/internal/uuid"
)

type mfaChallengeRequest struct {
	ChallengeToken string `json:"challenge_token"`
	Code           string `json:"code"`
	UseRecovery    bool   `json:"use_recovery"`
}

type mfaEnrollVerifyRequest struct {
	Code string `json:"code"`
}

type mfaDisableRequest struct {
	Password    string `json:"password"`
	Code        string `json:"code"`
	UseRecovery bool   `json:"use_recovery"`
}

type mfaRegenerateRequest struct {
	Code string `json:"code"`
}

func (h *Handler) MFAEnroll(w http.ResponseWriter, r *http.Request) error {
	caller, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("authentication required")
	}
	user, err := h.svc.Querier().GetUserByID(r.Context(), caller.ID)
	if err != nil {
		return err
	}
	if user.MFAEnabled {
		return apperr.Conflict("MFA is already enabled. Disable it first to re-enroll.")
	}
	secret, err := authservice.GenerateMFASecret()
	if err != nil {
		return err
	}
	if err := h.svc.Querier().SetUserMFA(r.Context(), user.ID, false, sql.NullString{Valid: true, String: secret}); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{
		"secret":       secret,
		"otpauth_url":  authservice.BuildOTPAuthURL(user.Email, secret),
	})
}

func (h *Handler) MFAEnrollVerify(w http.ResponseWriter, r *http.Request) error {
	caller, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("authentication required")
	}
	var body mfaEnrollVerifyRequest
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	user, err := h.svc.Querier().GetUserByID(r.Context(), caller.ID)
	if err != nil {
		return err
	}
	if !user.MFASecret.Valid {
		return apperr.Validation("no pending MFA enrollment. start enrollment first.")
	}
	if user.MFAEnabled {
		return apperr.Conflict("MFA is already enabled.")
	}
	if !authservice.VerifyTOTP(body.Code, user.MFASecret.String) {
		return apperr.Validation("invalid code. scan the QR and try again.")
	}
	if err := h.svc.Querier().SetUserMFA(r.Context(), user.ID, true, user.MFASecret); err != nil {
		return err
	}
	codes, err := authservice.GenerateRecoveryCodes()
	if err != nil {
		return err
	}
	if err := h.svc.Querier().DeleteRecoveryCodesForUser(r.Context(), user.ID); err != nil {
		return err
	}
	for _, c := range codes {
		if err := h.svc.Querier().CreateRecoveryCode(r.Context(), authservice.CreateTokenParams{
			ID:        uuid.V4(),
			UserID:    user.ID,
			TokenHash: authservice.HashToken(c),
		}); err != nil {
			return err
		}
	}
	return writeJSON(w, http.StatusOK, map[string]any{"recovery_codes": codes})
}

func (h *Handler) MFAVerifyChallenge(w http.ResponseWriter, r *http.Request) error {
	var body mfaChallengeRequest
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	claims, err := h.svc.Secrets().Verify(r.Context(), body.ChallengeToken)
	if err != nil || claims.Stage != "mfa_pending" || claims.RegisteredClaims.Subject == "" {
		return apperr.Unauthorized("challenge token invalid or expired")
	}
	user, err := h.svc.Querier().GetUserByID(r.Context(), claims.RegisteredClaims.Subject)
	if err != nil {
		return apperr.Unauthorized("MFA not configured")
	}
	if !user.MFAEnabled || !user.MFASecret.Valid {
		return apperr.Unauthorized("MFA not configured")
	}
	if user.LockedUntil.Valid && user.LockedUntil.Time.After(time.Now().UTC()) {
		return apperr.AppError{Code: "rate_limited", Detail: "too many failed attempts. try again later.", Status: http.StatusTooManyRequests}
	}
	ok := false
	if body.UseRecovery {
		codes, err := h.svc.Querier().GetUnusedRecoveryCodes(r.Context(), user.ID)
		if err != nil {
			return err
		}
		needle := authservice.HashToken(strings.TrimSpace(body.Code))
		for _, c := range codes {
			if c.CodeHash == needle {
				if err := h.svc.Querier().MarkRecoveryCodeUsed(r.Context(), c.ID); err != nil {
					return err
				}
				ok = true
				break
			}
		}
	} else {
		ok = authservice.VerifyTOTP(body.Code, user.MFASecret.String)
	}
	if !ok {
		_, locked, ferr := h.svc.Querier().RecordLoginFailure(r.Context(), user.ID, LoginMaxAttempts, LoginLockoutMinutes)
		if ferr != nil {
			return ferr
		}
		if locked.Valid && locked.Time.After(time.Now().UTC()) {
			return apperr.AppError{Code: "rate_limited", Detail: "too many failed attempts. try again later.", Status: http.StatusTooManyRequests}
		}
		return apperr.Unauthorized("invalid MFA code")
	}
	if err := h.svc.Querier().UpdateUserLastLogin(r.Context(), user.ID); err != nil {
		return err
	}
	session, err := h.svc.IssueSession(r.Context(), authservice.IssueSessionInput{
		User: user, IPAddress: clientIP(r), UserAgent: userAgent(r),
	})
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{
		"user":          serializeUser(user),
		"token":         session.Tokens.AccessToken,
		"access_token":  session.Tokens.AccessToken,
		"refresh_token": session.Tokens.RefreshToken,
	})
}

func (h *Handler) MFADisable(w http.ResponseWriter, r *http.Request) error {
	caller, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("authentication required")
	}
	var body mfaDisableRequest
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	user, err := h.svc.Querier().GetUserByID(r.Context(), caller.ID)
	if err != nil {
		return err
	}
	if !user.MFAEnabled || !user.MFASecret.Valid {
		return apperr.Validation("MFA is not enabled.")
	}
	if !authservice.VerifyPassword(body.Password, user.PasswordHash) {
		return apperr.Validation("invalid password")
	}
	mfaOK := false
	if body.UseRecovery {
		codes, err := h.svc.Querier().GetUnusedRecoveryCodes(r.Context(), user.ID)
		if err != nil {
			return err
		}
		needle := authservice.HashToken(strings.TrimSpace(body.Code))
		for _, c := range codes {
			if c.CodeHash == needle {
				mfaOK = true
				break
			}
		}
	} else {
		mfaOK = authservice.VerifyTOTP(body.Code, user.MFASecret.String)
	}
	if !mfaOK {
		return apperr.Validation("invalid MFA code")
	}
	if err := h.svc.Querier().SetUserMFA(r.Context(), user.ID, false, sql.NullString{}); err != nil {
		return err
	}
	if err := h.svc.Querier().DeleteRecoveryCodesForUser(r.Context(), user.ID); err != nil {
		return err
	}
	return writeNoContent(w)
}

func (h *Handler) MFARegenerate(w http.ResponseWriter, r *http.Request) error {
	caller, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("authentication required")
	}
	var body mfaRegenerateRequest
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	user, err := h.svc.Querier().GetUserByID(r.Context(), caller.ID)
	if err != nil {
		return err
	}
	if !user.MFAEnabled || !user.MFASecret.Valid {
		return apperr.Validation("MFA is not enabled.")
	}
	if !authservice.VerifyTOTP(body.Code, user.MFASecret.String) {
		return apperr.Validation("invalid MFA code")
	}
	if err := h.svc.Querier().DeleteRecoveryCodesForUser(r.Context(), user.ID); err != nil {
		return err
	}
	codes, err := authservice.GenerateRecoveryCodes()
	if err != nil {
		return err
	}
	for _, c := range codes {
		if err := h.svc.Querier().CreateRecoveryCode(r.Context(), authservice.CreateTokenParams{
			ID:        uuid.V4(),
			UserID:    user.ID,
			TokenHash: authservice.HashToken(c),
		}); err != nil {
			return err
		}
	}
	return writeJSON(w, http.StatusOK, map[string]any{"recovery_codes": codes})
}
