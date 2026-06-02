package mailer

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildResetAndVerificationLinks(t *testing.T) {
	t.Setenv("FRONTEND_URL", "https://app.example.com/")
	reset := BuildResetLink("abc")
	verify := BuildVerificationLink("xyz")
	assert.True(t, strings.HasPrefix(reset, "https://app.example.com/reset-password?token="))
	assert.Contains(t, reset, "token=abc")
	assert.True(t, strings.HasPrefix(verify, "https://app.example.com/verify-email?token="))
	assert.Contains(t, verify, "token=xyz")
}

func TestDefaultFrontendURL(t *testing.T) {
	t.Setenv("FRONTEND_URL", "")
	assert.Equal(t, "http://localhost:5173/reset-password?token=t", BuildResetLink("t"))
}

func TestMailerSendWithoutConfigLogs(t *testing.T) {
	m := New(nil)
	require.NoError(t, m.Load(context.Background()))
	assert.NoError(t, m.SendPasswordReset("user@example.com", "https://example.com/reset"))
	assert.NoError(t, m.SendVerification("user@example.com", "https://example.com/verify"))
}

func TestDefaultFrom(t *testing.T) {
	t.Setenv("FRONTEND_URL", "https://app.example.com")
	assert.Equal(t, "noreply@app.example.com", defaultFrom())
}
