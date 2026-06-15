package mailer

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"projx.local/go/internal/serviceconfig"
)

func TestLoadWithoutServiceLogsOnly(t *testing.T) {
	m := New(nil)
	err := m.Load(context.Background())
	require.NoError(t, err)
	cfg, loaded := m.snapshot()
	assert.True(t, loaded)
	assert.Nil(t, cfg)
}

func TestSendDevMode(t *testing.T) {
	m := New(nil)
	require.NoError(t, m.Load(context.Background()))
	assert.NoError(t, m.send("to@example.com", "subj", "body"))
}

func TestSendWithFailingTransport(t *testing.T) {
	m := New(nil)
	m.cfg = &Config{Host: "127.0.0.1", Port: 1}
	m.loaded = true
	err := m.send("to@example.com", "subj", "body")
	assert.Error(t, err)
}

func TestLoadFromServiceConfigSimulated(t *testing.T) {
	t.Setenv("CRED_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	sqlDB, _, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	require.NoError(t, err)
	defer sqlDB.Close()
	gdb, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB, PreferSimpleProtocol: true, WithoutQuotingCheck: true}), &gorm.Config{})
	require.NoError(t, err)
	svc, err := serviceconfig.NewService(gdb)
	require.NoError(t, err)
	_ = svc

	m := New(svc)
	require.NoError(t, m.Load(context.Background()))
	cfg, loaded := m.snapshot()
	assert.True(t, loaded)
	assert.Nil(t, cfg)
}

var _ = json.Marshal
