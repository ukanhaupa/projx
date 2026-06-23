package handlers

import (
	"errors"
	"net/http"
	"time"

	"projx.local/go/ent"
	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth"
	authservice "projx.local/go/internal/auth/service"
)

type refreshReq struct {
	RefreshToken string `json:"refresh_token"`
}

func (d *Deps) Refresh(w http.ResponseWriter, r *http.Request) error {
	var body refreshReq
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if body.RefreshToken == "" {
		return apperr.Unauthorized("")
	}
	ctx := r.Context()
	claims, err := d.Service.Signer().VerifyRefreshToken(ctx, body.RefreshToken)
	if err != nil {
		return apperr.Unauthorized("")
	}
	if v, _ := claims["token_type"].(string); v != "refresh" {
		return apperr.Unauthorized("")
	}
	sub, _ := claims["sub"].(string)
	sid, _ := claims["sid"].(string)
	if sub == "" || sid == "" {
		return apperr.Unauthorized("")
	}

	presentedHash := authservice.HashToken(body.RefreshToken)
	sess, err := d.Service.FindSessionByTokenHash(ctx, presentedHash)
	if err != nil {
		return err
	}
	if sess.SessionID != sid || sess.UserID != sub {
		return apperr.Unauthorized("")
	}

	revokeForReplay := func(replay *ent.Session) error {
		if err := d.Service.MarkSessionReplay(ctx, replay); err != nil {
			d.Logger.Error("[auth] mark replay failed", "error", err.Error())
		}
		d.Logger.Warn("refresh_token_replay_detected",
			"session_id", replay.SessionID,
			"user_id", replay.UserID,
		)
		return apperr.Unauthorized("token_replay_detected")
	}

	// A session row that was cleanly rotated (never flagged as a replay) whose
	// replacement is still the unused head of the chain is a lost-rotation
	// retry, not an attack: the client never persisted the replacement (app
	// killed mid-rotation) and re-presents the old token on next launch.
	// Re-rotating off the still-unused replacement recovers the session instead
	// of nuking it. A genuine replay — replacement already used/revoked/flagged,
	// or the chain advanced — falls through to strict reuse-detection.
	active := sess
	if sess.RotatedTo != nil || sess.RevokedAt != nil {
		graceChild := d.Service.ResolveRotationGraceChild(ctx, sess)
		if graceChild == nil {
			return revokeForReplay(sess)
		}
		active = graceChild
	}
	if active.ExpiresAt.Before(time.Now()) {
		return apperr.Unauthorized("")
	}

	u, err := d.Service.FindUserByID(ctx, sub)
	if err != nil {
		return apperr.Unauthorized("")
	}

	for attempt := 1; ; attempt++ {
		resp, err := d.Service.RotateSession(ctx, active, u, clientIP(r), r.UserAgent())
		if err == nil {
			return writeJSON(w, http.StatusOK, resp)
		}
		if !errors.Is(err, authservice.ErrRotationConflict) {
			return err
		}
		current, ferr := d.Service.FindSessionByID(ctx, active.ID)
		if ferr != nil {
			return revokeForReplay(active)
		}
		graceChild := d.Service.ResolveRotationGraceChild(ctx, current)
		if graceChild == nil || attempt >= authservice.MaxRotationAttempts {
			return revokeForReplay(current)
		}
		active = graceChild
	}
}

type logoutReq struct {
	SessionID string `json:"session_id"`
}

func (d *Deps) Logout(w http.ResponseWriter, r *http.Request) error {
	user, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("")
	}
	var body logoutReq
	if r.ContentLength > 0 {
		if err := decodeJSON(r, &body); err != nil {
			body = logoutReq{}
		}
	}
	sessionID := body.SessionID
	if sessionID == "" {
		sessionID = user.SID
	}
	if sessionID == "" {
		return apperr.Validation("session_id is required")
	}
	if err := d.Service.RevokeSessionsBySessionID(r.Context(), user.ID, sessionID); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d *Deps) Sessions(w http.ResponseWriter, r *http.Request) error {
	user, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("")
	}
	sessions, err := d.Service.ListActiveSessions(r.Context(), user.ID)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	out := make([]authservice.SessionSummary, 0, len(sessions))
	for _, s := range sessions {
		if seen[s.SessionID] {
			continue
		}
		seen[s.SessionID] = true
		out = append(out, authservice.SessionSummary{
			ID:        s.SessionID,
			IPAddress: s.IPAddress,
			UserAgent: s.UserAgent,
			ExpiresAt: s.ExpiresAt,
			CreatedAt: s.CreatedAt,
			Current:   user.SID == s.SessionID,
		})
	}
	return writeJSON(w, http.StatusOK, map[string]any{"data": out})
}

func (d *Deps) Me(w http.ResponseWriter, r *http.Request) error {
	user, ok := auth.FromContext(r.Context())
	if !ok {
		return apperr.Unauthorized("")
	}
	u, err := d.Service.FindUserByID(r.Context(), user.ID)
	if err != nil {
		var ae apperr.AppError
		if errors.As(err, &ae) && ae.Status == http.StatusNotFound {
			return apperr.NotFound("user")
		}
		return err
	}
	return writeJSON(w, http.StatusOK, d.Service.UserDTO(u))
}
