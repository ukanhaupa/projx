package authservice

import "time"

type UserDTO struct {
	ID            string     `json:"id"`
	Email         string     `json:"email"`
	Name          string     `json:"name"`
	Role          string     `json:"role"`
	EmailVerified bool       `json:"email_verified"`
	MFAEnabled    bool       `json:"mfa_enabled"`
	LastLogin     *time.Time `json:"last_login,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type AuthSessionResponse struct {
	User         UserDTO `json:"user"`
	Token        string  `json:"token"`
	AccessToken  string  `json:"access_token"`
	RefreshToken string  `json:"refresh_token"`
}

type SessionSummary struct {
	ID        string    `json:"id"`
	IPAddress string    `json:"ip_address,omitempty"`
	UserAgent string    `json:"user_agent,omitempty"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
	Current   bool      `json:"current"`
}
