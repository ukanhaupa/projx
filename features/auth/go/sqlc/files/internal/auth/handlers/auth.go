package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth"
	authservice "projx.local/go/internal/auth/service"
	"projx.local/go/internal/requestid"
	"projx.local/go/internal/uuid"
)

type signupRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type logoutRequest struct {
	SessionID string `json:"session_id"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

type forgotPasswordRequest struct {
	Email string `json:"email"`
}

type resetPasswordRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

type verifyEmailRequest struct {
	Token string `json:"token"`
}

type resendVerificationRequest struct {
	Email string `json:"email"`
}

func validatePassword(p string) error {
	if len(p) < 8 {
		return apperr.Validation("password must be at least 8 characters")
	}
	return nil
}

func validateEmail(e string) error {
	e = strings.TrimSpace(strings.ToLower(e))
	if e == "" || !strings.Contains(e, "@") {
		return apperr.Validation("invalid email")
	}
	return nil
}

func (h *Handler) Signup(w http.ResponseWriter, r *http.Request) error {
	var body signupRequest
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if err := validateEmail(body.Email); err != nil {
		return err
	}
	if err := validatePassword(body.Password); err != nil {
		return err
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if existing, err := h.svc.Querier().GetUserByEmail(r.Context(), email); err == nil && existing != nil {
		return apperr.Conflict("an account with this email already exists")
	} else if err != nil && !isNotFound(err) {
		return err
	}
	hash, err := authservice.HashPassword(body.Password)
	if err != nil {
		return err
	}
	count, err := h.svc.Querier().CountUsers(r.Context())
	if err != nil {
		return err
	}
	role := "user"
	if count == 0 {
		role = "admin"
	}
	user, err := h.svc.Querier().CreateUser(r.Context(), authservice.CreateUserParams{
		ID:           uuid.V4(),
		Email:        email,
		PasswordHash: hash,
		Name:         strings.TrimSpace(body.Name),
		Role:         role,
	})
	if err != nil {
		return err
	}
	session, err := h.svc.IssueSession(r.Context(), authservice.IssueSessionInput{
		User: user, IPAddress: clientIP(r), UserAgent: userAgent(r),
	})
	if err != nil {
		return err
	}
	go h.sendInitialVerification(requestid.FromContext(r.Context()), user.ID, user.Email)
	return writeJSON(w, http.StatusCreated, map[string]any{
		"user":          serializeUser(user),
		"token":         session.Tokens.AccessToken,
		"access_token":  session.Tokens.AccessToken,
		"refresh_token": session.Tokens.RefreshToken,
	})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) error {
	var body loginRequest
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	user, err := h.svc.Querier().GetUserByEmail(r.Context(), email)
	if err != nil && !isNotFound(err) {
		return err
	}
	if user == nil {
		return apperr.Unauthorized("invalid credentials")
	}
	if user.LockedUntil.Valid && user.LockedUntil.Time.After(time.Now().UTC()) {
		return apperr.AppError{Code: "rate_limited", Detail: "too many failed attempts. try again later.", Status: http.StatusTooManyRequests}
	}
	if !authservice.VerifyPassword(body.Password, user.PasswordHash) {
		_, locked, ferr := h.svc.Querier().RecordLoginFailure(r.Context(), user.ID, LoginMaxAttempts, LoginLockoutMinutes)
		if ferr != nil {
			return ferr
		}
		if locked.Valid && locked.Time.After(time.Now().UTC()) {
			return apperr.AppError{Code: "rate_limited", Detail: "too many failed attempts. try again later.", Status: http.StatusTooManyRequests}
		}
		return apperr.Unauthorized("invalid credentials")
	}
	if user.MFAEnabled {
		challenge, err := h.svc.Secrets().SignMFAChallenge(r.Context(), user.ID)
		if err != nil {
			return err
		}
		return writeJSON(w, http.StatusOK, map[string]any{
			"mfa_required":    true,
			"challenge_token": challenge,
			"email":           user.Email,
		})
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

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) error {
	var body refreshRequest
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if strings.TrimSpace(body.RefreshToken) == "" {
		return apperr.Unauthorized("refresh_token is required")
	}
	res, err := h.svc.Refresh(r.Context(), body.RefreshToken, clientIP(r), userAgent(r))
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{
		"token":         res.Tokens.AccessToken,
		"access_token":  res.Tokens.AccessToken,
		"refresh_token": res.Tokens.RefreshToken,
	})
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) error {
	user, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("authentication required")
	}
	var body logoutRequest
	_ = decodeJSON(r, &body)
	sessionID := strings.TrimSpace(body.SessionID)
	if sessionID == "" {
		sessionID = user.SID
	}
	if sessionID == "" {
		return apperr.Validation("session_id is required")
	}
	session, err := h.svc.Querier().GetSessionByID(r.Context(), sessionID)
	if err != nil {
		if isNotFound(err) {
			return writeNoContent(w)
		}
		return err
	}
	if session.UserID != user.ID {
		return apperr.Forbidden("cannot revoke another user's session")
	}
	if err := h.svc.Querier().RevokeSession(r.Context(), sessionID); err != nil {
		return err
	}
	return writeNoContent(w)
}

func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) error {
	user, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("authentication required")
	}
	var body changePasswordRequest
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if err := validatePassword(body.NewPassword); err != nil {
		return err
	}
	full, err := h.svc.Querier().GetUserByID(r.Context(), user.ID)
	if err != nil {
		return err
	}
	if !authservice.VerifyPassword(body.CurrentPassword, full.PasswordHash) {
		return apperr.Validation("invalid password")
	}
	hash, err := authservice.HashPassword(body.NewPassword)
	if err != nil {
		return err
	}
	if err := h.svc.Querier().UpdateUserPassword(r.Context(), user.ID, hash); err != nil {
		return err
	}
	except := sqlNullStringFrom(user.SID)
	if err := h.svc.Querier().RevokeSessionsForUser(r.Context(), user.ID, except); err != nil {
		return err
	}
	return writeNoContent(w)
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) error {
	caller, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("authentication required")
	}
	user, err := h.svc.Querier().GetUserByID(r.Context(), caller.ID)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, serializeUser(user))
}

func (h *Handler) ListSessions(w http.ResponseWriter, r *http.Request) error {
	caller, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("authentication required")
	}
	sessions, err := h.svc.Querier().ListActiveSessionsForUser(r.Context(), caller.ID)
	if err != nil {
		return err
	}
	out := make([]map[string]any, 0, len(sessions))
	for _, s := range sessions {
		out = append(out, map[string]any{
			"id":         s.ID,
			"ip_address": nullStringValue(s.IPAddress),
			"user_agent": nullStringValue(s.UserAgent),
			"expires_at": s.ExpiresAt,
			"created_at": s.CreatedAt,
			"current":    s.ID == caller.SID,
		})
	}
	return writeJSON(w, http.StatusOK, map[string]any{"data": out})
}

func (h *Handler) ForgotPassword(w http.ResponseWriter, r *http.Request) error {
	var body forgotPasswordRequest
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	message := map[string]any{"message": "If the account exists, a password reset link has been generated."}
	user, err := h.svc.Querier().GetUserByEmail(r.Context(), email)
	if err != nil {
		if isNotFound(err) {
			return writeJSON(w, http.StatusOK, message)
		}
		return err
	}
	raw, err := authservice.RandomToken(32)
	if err != nil {
		return err
	}
	if err := h.svc.Querier().CreatePasswordResetToken(r.Context(), authservice.CreateTokenParams{
		ID:        uuid.V4(),
		UserID:    user.ID,
		TokenHash: authservice.HashToken(raw),
		ExpiresAt: time.Now().UTC().Add(ResetTokenTTL),
	}); err != nil {
		return err
	}
	link, err := h.mailer.BuildResetLink(r.Context(), raw)
	if err == nil {
		if err := h.mailer.SendPasswordReset(r.Context(), user.Email, link); err != nil {
			slog.Warn("password reset email failed", "error", err, "request_id", requestid.FromContext(r.Context()), "user_id", user.ID)
		}
	}
	return writeJSON(w, http.StatusOK, message)
}

func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) error {
	var body resetPasswordRequest
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if err := validatePassword(body.NewPassword); err != nil {
		return err
	}
	rec, err := h.svc.Querier().GetPasswordResetToken(r.Context(), authservice.HashToken(body.Token))
	if err != nil {
		return apperr.Validation("invalid or expired reset token")
	}
	hash, err := authservice.HashPassword(body.NewPassword)
	if err != nil {
		return err
	}
	if err := h.svc.Querier().UpdateUserPassword(r.Context(), rec.UserID, hash); err != nil {
		return err
	}
	if err := h.svc.Querier().MarkPasswordResetTokenUsed(r.Context(), rec.ID); err != nil {
		return err
	}
	if err := h.svc.Querier().RevokeSessionsForUser(r.Context(), rec.UserID, sqlNullStringFrom("")); err != nil {
		return err
	}
	return writeNoContent(w)
}

func (h *Handler) VerifyEmail(w http.ResponseWriter, r *http.Request) error {
	var body verifyEmailRequest
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	rec, err := h.svc.Querier().GetEmailVerifyToken(r.Context(), authservice.HashToken(body.Token))
	if err != nil {
		return apperr.Validation("invalid or expired verification token")
	}
	if err := h.svc.Querier().MarkEmailVerified(r.Context(), rec.UserID); err != nil {
		return err
	}
	if err := h.svc.Querier().MarkEmailVerifyTokenUsed(r.Context(), rec.ID); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"verified": true})
}

func (h *Handler) ResendVerification(w http.ResponseWriter, r *http.Request) error {
	var body resendVerificationRequest
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	user, err := h.svc.Querier().GetUserByEmail(r.Context(), email)
	if err != nil && !isNotFound(err) {
		return err
	}
	if user != nil && !user.EmailVerifiedAt.Valid {
		raw, err := authservice.RandomToken(32)
		if err != nil {
			return err
		}
		if err := h.svc.Querier().CreateEmailVerifyToken(r.Context(), authservice.CreateTokenParams{
			ID:        uuid.V4(),
			UserID:    user.ID,
			TokenHash: authservice.HashToken(raw),
			ExpiresAt: time.Now().UTC().Add(VerifyTokenTTL),
		}); err != nil {
			return err
		}
		link, err := h.mailer.BuildVerificationLink(r.Context(), raw)
		if err == nil {
			if err := h.mailer.SendVerification(r.Context(), user.Email, link); err != nil {
				slog.Warn("verification email failed", "error", err, "request_id", requestid.FromContext(r.Context()), "user_id", user.ID)
			}
		}
	}
	return writeJSON(w, http.StatusAccepted, map[string]any{"sent": true})
}

func (h *Handler) sendInitialVerification(requestID, userID, email string) {
	raw, err := authservice.RandomToken(32)
	if err != nil {
		return
	}
	ctx := contextWithoutCancel()
	if err := h.svc.Querier().CreateEmailVerifyToken(ctx, authservice.CreateTokenParams{
		ID:        uuid.V4(),
		UserID:    userID,
		TokenHash: authservice.HashToken(raw),
		ExpiresAt: time.Now().UTC().Add(VerifyTokenTTL),
	}); err != nil {
		slog.Warn("initial verification token create failed", "error", err, "request_id", requestID, "user_id", userID)
		return
	}
	link, err := h.mailer.BuildVerificationLink(ctx, raw)
	if err != nil {
		return
	}
	if err := h.mailer.SendVerification(ctx, email, link); err != nil {
		slog.Warn("initial verification email failed", "error", err, "request_id", requestID, "user_id", userID)
	}
}

func serializeUser(u *authservice.User) map[string]any {
	return map[string]any{
		"id":             u.ID,
		"email":          u.Email,
		"name":           u.Name,
		"role":           u.Role,
		"email_verified": u.EmailVerifiedAt.Valid,
		"mfa_enabled":    u.MFAEnabled,
		"last_login":     nullTimeValue(u.LastLoginAt),
		"created_at":     u.CreatedAt,
		"updated_at":     u.UpdatedAt,
	}
}

func isNotFound(err error) bool {
	var ae apperr.AppError
	return errors.As(err, &ae) && ae.Status == http.StatusNotFound
}
