package apperr

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestStatusOfMapping(t *testing.T) {
	cases := []struct {
		err  error
		want int
	}{
		{Validation("bad"), http.StatusUnprocessableEntity},
		{NotFound("user"), http.StatusNotFound},
		{Conflict("dup"), http.StatusConflict},
		{Unauthorized(""), http.StatusUnauthorized},
		{Forbidden(""), http.StatusForbidden},
		{errors.New("boom"), http.StatusInternalServerError},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, StatusOf(c.err), c.err.Error())
	}
}

func TestErrorsAsAppError(t *testing.T) {
	wrapped := fmt.Errorf("context: %w", NotFound("post"))
	var ae AppError
	assert.True(t, errors.As(wrapped, &ae))
	assert.Equal(t, http.StatusNotFound, ae.Status)
}

func TestUnauthorizedDefaultDetail(t *testing.T) {
	err := Unauthorized("")
	assert.Equal(t, "unauthorized", err.Detail)
}

func TestForbiddenDefaultDetail(t *testing.T) {
	err := Forbidden("")
	assert.Equal(t, "forbidden", err.Detail)
}

func TestDetailOfFallsBackForUnknown(t *testing.T) {
	assert.Equal(t, "internal server error", DetailOf(errors.New("x")))
}
