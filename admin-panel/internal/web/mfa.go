package web

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strings"

	"adminpanel/internal/auth"
)

func otpauthURL(secret, account string) string {
	return auth.OTPAuthURL(secret, account)
}

const recoveryFlash = "admin_recovery"

func (s *Server) requireMFA(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sess := sessionFrom(r)
		if sess == nil {
			http.Redirect(w, r, s.base+"/login", http.StatusSeeOther)
			return
		}
		if !sess.MFAEnrolled {
			http.Redirect(w, r, s.base+"/2fa/enroll", http.StatusSeeOther)
			return
		}
		if !sess.MFAPassed {
			http.Redirect(w, r, s.base+"/2fa", http.StatusSeeOther)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) enrollForm(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r)
	if sess == nil {
		http.Redirect(w, r, s.base+"/login", http.StatusSeeOther)
		return
	}
	if sess.MFAEnrolled {
		http.Redirect(w, r, s.base+"/2fa", http.StatusSeeOther)
		return
	}
	enrollment, err := s.store.BeginEnrollment(r.Context(), sess.User.ID)
	if err != nil {
		http.Error(w, "could not start enrollment", http.StatusInternalServerError)
		return
	}
	s.renderMFA(w, r, "mfa_enroll", viewData{
		Title:         "Set up two-factor authentication",
		Action:        s.base + "/2fa/enroll",
		MFASecret:     enrollment.Secret,
		OTPAuthURL:    enrollment.OTPAuthURL,
		RecoveryCodes: enrollment.RecoveryCodes,
	})
}

func (s *Server) enrollSubmit(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r)
	if sess == nil {
		http.Redirect(w, r, s.base+"/login", http.StatusSeeOther)
		return
	}
	enrollment, err := s.store.BeginEnrollment(r.Context(), sess.User.ID)
	if err != nil {
		http.Error(w, "could not start enrollment", http.StatusInternalServerError)
		return
	}
	secret := r.FormValue("secret")
	if secret == "" {
		secret = enrollment.Secret
	}
	codes := splitCodes(r.FormValue("recovery_codes"))
	if len(codes) == 0 {
		codes = enrollment.RecoveryCodes
	}
	err = s.store.CompleteEnrollment(r.Context(), sess.User.ID, secret, codes, r.FormValue("code"))
	if err != nil {
		s.renderMFA(w, r, "mfa_enroll", viewData{
			Title:         "Set up two-factor authentication",
			Action:        s.base + "/2fa/enroll",
			MFASecret:     secret,
			OTPAuthURL:    otpauthURL(secret, sess.User.Email),
			RecoveryCodes: codes,
			Error:         "That code did not match. Scan the secret and try again.",
		})
		return
	}
	if err := s.store.MarkSessionMFAPassed(r.Context(), sessionToken(r)); err != nil {
		http.Error(w, "could not complete enrollment", http.StatusInternalServerError)
		return
	}
	s.setFlashCodes(w, codes)
	http.Redirect(w, r, s.base+"/2fa/recovery", http.StatusSeeOther)
}

func (s *Server) recoveryPage(w http.ResponseWriter, r *http.Request) {
	codes := readFlashCodes(r)
	clearFlashCodes(w)
	s.renderMFA(w, r, "mfa_recovery", viewData{
		Title:         "Save your recovery codes",
		RecoveryCodes: codes,
	})
}

func (s *Server) challengeForm(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r)
	if sess == nil {
		http.Redirect(w, r, s.base+"/login", http.StatusSeeOther)
		return
	}
	if !sess.MFAEnrolled {
		http.Redirect(w, r, s.base+"/2fa/enroll", http.StatusSeeOther)
		return
	}
	if sess.MFAPassed {
		http.Redirect(w, r, s.base+"/", http.StatusSeeOther)
		return
	}
	s.renderAuth(w, r, viewData{Title: "Sign in", Step: "code"})
}

func (s *Server) challengeSubmit(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r)
	if sess == nil {
		http.Redirect(w, r, s.base+"/login", http.StatusSeeOther)
		return
	}
	if !sess.MFAEnrolled {
		http.Redirect(w, r, s.base+"/2fa/enroll", http.StatusSeeOther)
		return
	}
	ok, err := s.store.VerifyMFAChallenge(r.Context(), sess.User.ID, r.FormValue("code"))
	if errors.Is(err, auth.ErrMFALocked) {
		s.renderAuth(w, r, viewData{Title: "Sign in", Step: "code", Error: "Too many attempts. Try again later."})
		return
	}
	if err != nil {
		http.Error(w, "could not verify code", http.StatusInternalServerError)
		return
	}
	if !ok {
		s.renderAuth(w, r, viewData{Title: "Sign in", Step: "code", Error: "Invalid authentication code."})
		return
	}
	if err := s.store.MarkSessionMFAPassed(r.Context(), sessionToken(r)); err != nil {
		http.Error(w, "could not complete sign-in", http.StatusInternalServerError)
		return
	}
	s.redirectAuth(w, r, s.base+"/")
}

func (s *Server) renderAuth(w http.ResponseWriter, r *http.Request, data viewData) {
	data.Base = s.base
	t, ok := s.tmpl["login"]
	if !ok {
		http.Error(w, "template not found", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	name := "layout"
	if isHTMXRequest(r) {
		name = "auth-step"
	}
	if err := t.ExecuteTemplate(w, name, data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (s *Server) redirectAuth(w http.ResponseWriter, r *http.Request, target string) {
	if isHTMXRequest(r) {
		w.Header().Set("HX-Redirect", target)
		w.WriteHeader(http.StatusOK)
		return
	}
	http.Redirect(w, r, target, http.StatusSeeOther)
}

func (s *Server) renderMFA(w http.ResponseWriter, r *http.Request, page string, data viewData) {
	data.Base = s.base
	t, ok := s.tmpl[page]
	if !ok {
		http.Error(w, "template not found", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	name := "layout"
	if isHTMXRequest(r) {
		name = "content"
	}
	if err := t.ExecuteTemplate(w, name, data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func splitCodes(raw string) []string {
	return strings.Fields(raw)
}

func (s *Server) setFlashCodes(w http.ResponseWriter, codes []string) {
	encoded := base64.RawURLEncoding.EncodeToString([]byte(strings.Join(codes, " ")))
	http.SetCookie(w, &http.Cookie{
		Name:     recoveryFlash,
		Value:    encoded,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.secure,
	})
}

func readFlashCodes(r *http.Request) []string {
	c, err := r.Cookie(recoveryFlash)
	if err != nil || c.Value == "" {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(c.Value)
	if err != nil {
		return nil
	}
	return splitCodes(string(raw))
}

func clearFlashCodes(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     recoveryFlash,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}
