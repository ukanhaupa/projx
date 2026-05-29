package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"projx.local/go/internal/requestid"
)

func newCapturingLogger() (*slog.Logger, *bytes.Buffer) {
	buf := &bytes.Buffer{}
	h := slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	return slog.New(h), buf
}

func TestNewReturnsLoggerWithDefaultLevel(t *testing.T) {
	t.Setenv("LOG_LEVEL", "")
	logger := New()
	require.NotNil(t, logger)
}

func TestNewParsesLogLevels(t *testing.T) {
	for _, lvl := range []string{"debug", "info", "warn", "warning", "error", "BOGUS"} {
		t.Setenv("LOG_LEVEL", lvl)
		require.NotNil(t, New())
	}
}

func TestMiddlewareEmitsAccessLogAfterHandler(t *testing.T) {
	logger, buf := newCapturingLogger()

	handlerInvoked := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerInvoked = true
		assert.Empty(t, buf.String(), "logger must not emit before handler runs")
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("hi"))
	})

	mw := Middleware(logger)(next)
	req := httptest.NewRequest(http.MethodGet, "/things", nil)
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, req)

	require.True(t, handlerInvoked)
	require.NotEmpty(t, buf.String(), "logger must emit after handler runs")

	var record map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &record))
	assert.Equal(t, "access", record["msg"])
	assert.Equal(t, "GET", record["method"])
	assert.Equal(t, "/things", record["path"])
	assert.EqualValues(t, http.StatusTeapot, record["status"])
	assert.EqualValues(t, 2, record["bytes"])
}

func TestMiddlewareDefaultStatusWhenHandlerOnlyWrites(t *testing.T) {
	logger, buf := newCapturingLogger()
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("body"))
	})
	mw := Middleware(logger)(next)
	mw.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))

	var record map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &record))
	assert.EqualValues(t, http.StatusOK, record["status"])
	assert.EqualValues(t, 4, record["bytes"])
}

func TestMiddlewareIncludesRequestIDFromContext(t *testing.T) {
	logger, buf := newCapturingLogger()
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mw := requestid.Middleware(Middleware(logger)(next))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(requestid.HeaderName, "fixed-id-abc")
	mw.ServeHTTP(httptest.NewRecorder(), req)

	assert.Contains(t, buf.String(), "fixed-id-abc")
}

func TestRecordingWriterIgnoresDoubleWriteHeader(t *testing.T) {
	logger, _ := newCapturingLogger()
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		w.WriteHeader(http.StatusInternalServerError)
	})
	rec := httptest.NewRecorder()
	Middleware(logger)(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	assert.Equal(t, http.StatusAccepted, rec.Code)
}

func TestMiddlewareEmitsExactlyOnce(t *testing.T) {
	logger, buf := newCapturingLogger()
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	Middleware(logger)(next).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	count := strings.Count(buf.String(), "\"msg\":\"access\"")
	assert.Equal(t, 1, count)
}

func TestMiddlewareNoRequestIDWhenAbsent(t *testing.T) {
	logger, buf := newCapturingLogger()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Empty(t, requestid.FromContext(r.Context()))
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(context.Background())
	Middleware(logger)(next).ServeHTTP(httptest.NewRecorder(), req)
	assert.Contains(t, buf.String(), "\"request_id\":\"\"")
}
