package handlers

import (
	"context"
	"database/sql"
)

func sqlNullStringFrom(v string) sql.NullString {
	if v == "" {
		return sql.NullString{}
	}
	return sql.NullString{Valid: true, String: v}
}

func nullStringValue(v sql.NullString) any {
	if v.Valid {
		return v.String
	}
	return nil
}

func nullTimeValue(v sql.NullTime) any {
	if v.Valid {
		return v.Time
	}
	return nil
}

func contextWithoutCancel() context.Context {
	return context.WithoutCancel(context.Background())
}

