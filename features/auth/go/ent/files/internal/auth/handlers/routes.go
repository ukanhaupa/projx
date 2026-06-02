package handlers

import (
	"github.com/go-chi/chi/v5"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth"
)

func (d *Deps) Routes() chi.Router {
	r := chi.NewRouter()
	r.Method("POST", "/signup", apperr.H(d.Signup))
	r.Method("POST", "/login", apperr.H(d.Login))
	r.Method("POST", "/mfa/verify-challenge", apperr.H(d.MFAVerifyChallenge))
	r.Method("POST", "/refresh", apperr.H(d.Refresh))
	r.Method("POST", "/forgot-password", apperr.H(d.ForgotPassword))
	r.Method("POST", "/reset-password", apperr.H(d.ResetPassword))
	r.Method("POST", "/verify-email", apperr.H(d.VerifyEmail))
	r.Method("POST", "/resend-verification", apperr.H(d.ResendVerification))

	r.Group(func(g chi.Router) {
		if d.Verifier != nil {
			g.Use(auth.Authenticate(d.Verifier))
		}
		g.Use(auth.AuthzRequireAuth)
		g.Method("POST", "/mfa/enroll", apperr.H(d.MFAEnroll))
		g.Method("POST", "/mfa/enroll/verify", apperr.H(d.MFAEnrollVerify))
		g.Method("POST", "/mfa/disable", apperr.H(d.MFADisable))
		g.Method("POST", "/mfa/recovery-codes/regenerate", apperr.H(d.MFARegenerateRecoveryCodes))
		g.Method("POST", "/logout", apperr.H(d.Logout))
		g.Method("POST", "/change-password", apperr.H(d.ChangePassword))
		g.Method("GET", "/sessions", apperr.H(d.Sessions))
		g.Method("GET", "/me", apperr.H(d.Me))
	})
	return r
}
