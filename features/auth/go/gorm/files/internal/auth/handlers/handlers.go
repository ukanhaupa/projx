package authhandlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"gorm.io/gorm"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/auth"
	"projx.local/go/internal/auth/mailer"
	authservice "projx.local/go/internal/auth/service"
	"projx.local/go/internal/serviceconfig"
)

type Deps struct {
	DB       *gorm.DB
	Sessions *authservice.Sessions
	Signer   *authservice.Signer
	Mailer   *mailer.Mailer
	Validate *validator.Validate
}

func NewDeps(db *gorm.DB, cfg *serviceconfig.Service) *Deps {
	signer := authservice.NewSigner(cfg)
	return &Deps{
		DB:       db,
		Sessions: authservice.NewSessions(db, signer),
		Signer:   signer,
		Mailer:   mailer.New(cfg),
		Validate: validator.New(validator.WithRequiredStructEnabled()),
	}
}

func Routes(d *Deps, verifier *auth.Verifier) http.Handler {
	r := chi.NewRouter()

	r.Post("/auth/signup", d.signup)
	r.Post("/auth/login", d.login)
	r.Post("/auth/refresh", d.refresh)
	r.Post("/auth/password-reset/request", d.passwordResetRequest)
	r.Post("/auth/password-reset/confirm", d.passwordResetConfirm)
	r.Post("/auth/email-verify/confirm", d.emailVerifyConfirm)

	r.Group(func(authed chi.Router) {
		if verifier != nil {
			authed.Use(auth.Authenticate(verifier))
		}
		authed.Use(auth.AuthzRequireAuth)
		authed.Post("/auth/logout", d.logout)
		authed.Post("/auth/email-verify/request", d.emailVerifyRequest)
		authed.Post("/auth/mfa/enroll", d.mfaEnroll)
		authed.Post("/auth/mfa/verify", d.mfaVerify)
		authed.Post("/auth/mfa/disable", d.mfaDisable)
	})

	return r
}

func decode(r *http.Request, dst any) error {
	if r.Body == nil {
		return errors.New("missing body")
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func validate(d *Deps, body any) error {
	if err := d.Validate.Struct(body); err != nil {
		return apperr.Validation(humanizeValidation(err))
	}
	return nil
}

func humanizeValidation(err error) string {
	var ve validator.ValidationErrors
	if errors.As(err, &ve) {
		parts := make([]string, 0, len(ve))
		for _, fe := range ve {
			parts = append(parts, fe.Field()+" "+fe.Tag())
		}
		return "invalid fields: " + strings.Join(parts, ", ")
	}
	return err.Error()
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if body != nil {
		_ = json.NewEncoder(w).Encode(body)
	}
}

func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		if i := strings.Index(fwd, ","); i >= 0 {
			return strings.TrimSpace(fwd[:i])
		}
		return strings.TrimSpace(fwd)
	}
	return r.RemoteAddr
}

func userAgent(r *http.Request) string {
	return r.Header.Get("User-Agent")
}
