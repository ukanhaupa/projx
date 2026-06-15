package authservice

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"

	"projx.local/go/internal/serviceconfig"
)

const ConfigPurposeJWT = "auth_jwt"
const ConfigPurposeSMTP = "auth_smtp"

type JWTConfig struct {
	Secret    string `json:"secret"`
	Algorithm string `json:"algorithm"`
	Issuer    string `json:"issuer"`
	Audience  string `json:"audience"`
}

type SMTPConfig struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	FromAddr  string `json:"from_address"`
	FromName  string `json:"from_name"`
	UseTLS    bool   `json:"use_tls"`
	FrontHost string `json:"frontend_url"`
}

type Secrets struct {
	configs *serviceconfig.Service
	mu      sync.RWMutex
	jwt     *JWTConfig
	smtp    *SMTPConfig
}

func NewSecrets(svc *serviceconfig.Service) *Secrets {
	return &Secrets{configs: svc}
}

func (s *Secrets) JWT(ctx context.Context) (*JWTConfig, error) {
	s.mu.RLock()
	if s.jwt != nil {
		c := *s.jwt
		s.mu.RUnlock()
		return &c, nil
	}
	s.mu.RUnlock()

	cfg, err := s.loadJWT(ctx)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.jwt = cfg
	s.mu.Unlock()
	c := *cfg
	return &c, nil
}

func (s *Secrets) loadJWT(ctx context.Context) (*JWTConfig, error) {
	if s.configs != nil {
		raw, err := s.configs.Get(ctx, ConfigPurposeJWT)
		if err == nil && strings.TrimSpace(raw) != "" {
			var c JWTConfig
			if err := json.Unmarshal([]byte(raw), &c); err != nil {
				return nil, err
			}
			if c.Algorithm == "" {
				c.Algorithm = "HS256"
			}
			if c.Secret == "" {
				return nil, errors.New("auth_jwt service_config missing secret")
			}
			return &c, nil
		}
	}
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return nil, errors.New("JWT_SECRET (env or service_config:auth_jwt) is required")
	}
	algo := os.Getenv("JWT_ALGORITHMS")
	if algo == "" {
		algo = "HS256"
	} else {
		algo = strings.TrimSpace(strings.Split(algo, ",")[0])
	}
	return &JWTConfig{Secret: secret, Algorithm: algo, Issuer: os.Getenv("JWT_ISSUER"), Audience: os.Getenv("JWT_AUDIENCE")}, nil
}

func (s *Secrets) SMTP(ctx context.Context) (*SMTPConfig, error) {
	s.mu.RLock()
	if s.smtp != nil {
		c := *s.smtp
		s.mu.RUnlock()
		return &c, nil
	}
	s.mu.RUnlock()

	cfg, err := s.loadSMTP(ctx)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.smtp = cfg
	s.mu.Unlock()
	c := *cfg
	return &c, nil
}

func (s *Secrets) loadSMTP(ctx context.Context) (*SMTPConfig, error) {
	if s.configs != nil {
		raw, err := s.configs.Get(ctx, ConfigPurposeSMTP)
		if err == nil && strings.TrimSpace(raw) != "" {
			var c SMTPConfig
			if err := json.Unmarshal([]byte(raw), &c); err != nil {
				return nil, err
			}
			return &c, nil
		}
	}
	return &SMTPConfig{
		Host:      os.Getenv("SMTP_HOST"),
		Username:  os.Getenv("SMTP_USERNAME"),
		Password:  os.Getenv("SMTP_PASSWORD"),
		FromAddr:  os.Getenv("SMTP_FROM"),
		FromName:  os.Getenv("SMTP_FROM_NAME"),
		FrontHost: os.Getenv("FRONTEND_URL"),
	}, nil
}

func (s *Secrets) Invalidate() {
	s.mu.Lock()
	s.jwt = nil
	s.smtp = nil
	s.mu.Unlock()
}
