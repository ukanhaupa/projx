package httputil

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWriteJSONHappyPath(t *testing.T) {
	rec := httptest.NewRecorder()
	err := WriteJSON(rec, http.StatusOK, map[string]string{"foo": "bar"})
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	var decoded map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &decoded))
	assert.Equal(t, "bar", decoded["foo"])
}

func TestWriteJSONCustomStatus(t *testing.T) {
	rec := httptest.NewRecorder()
	err := WriteJSON(rec, http.StatusTeapot, map[string]int{"n": 1})
	require.NoError(t, err)
	assert.Equal(t, http.StatusTeapot, rec.Code)
}

func TestWriteJSONNilBody(t *testing.T) {
	rec := httptest.NewRecorder()
	err := WriteJSON(rec, http.StatusOK, nil)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "null\n", rec.Body.String())
}

func TestWriteJSONUnmarshalableBody(t *testing.T) {
	rec := httptest.NewRecorder()
	err := WriteJSON(rec, http.StatusOK, make(chan int))
	require.Error(t, err)
	assert.True(t, strings.Contains(err.Error(), "unsupported type") || strings.Contains(err.Error(), "json"))
}
