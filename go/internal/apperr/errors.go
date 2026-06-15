package apperr

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

type AppError struct {
	Code   string
	Detail string
	Status int
}

func (e AppError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Detail)
}

func Validation(detail string) AppError {
	return AppError{Code: "validation_error", Detail: detail, Status: http.StatusUnprocessableEntity}
}

func NotFound(resource string) AppError {
	return AppError{Code: "not_found", Detail: resource + " not found", Status: http.StatusNotFound}
}

func Conflict(detail string) AppError {
	return AppError{Code: "conflict", Detail: detail, Status: http.StatusConflict}
}

func Unauthorized(detail string) AppError {
	if detail == "" {
		detail = "unauthorized"
	}
	return AppError{Code: "unauthorized", Detail: detail, Status: http.StatusUnauthorized}
}

func Forbidden(detail string) AppError {
	if detail == "" {
		detail = "forbidden"
	}
	return AppError{Code: "forbidden", Detail: detail, Status: http.StatusForbidden}
}

func StatusOf(err error) int {
	var ae AppError
	if errors.As(err, &ae) {
		return ae.Status
	}
	return http.StatusInternalServerError
}

func DetailOf(err error) string {
	var ae AppError
	if errors.As(err, &ae) {
		return ae.Detail
	}
	return "internal server error"
}

func FromDB(err error, resource string) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound(resource)
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return Conflict(resource + " already exists")
		case "23503":
			return Conflict(resource + " foreign key violation")
		}
	}
	return err
}
