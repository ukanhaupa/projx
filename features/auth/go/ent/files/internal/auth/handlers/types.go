package handlers

import (
	"log/slog"

	"projx.local/go/internal/auth"
	"projx.local/go/internal/auth/mailer"
	authservice "projx.local/go/internal/auth/service"
)

type Deps struct {
	Service  *authservice.Service
	Mailer   *mailer.Mailer
	Verifier *auth.Verifier
	Logger   *slog.Logger
}
