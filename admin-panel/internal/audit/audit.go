package audit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Action string

const (
	ActionInsert  Action = "insert"
	ActionUpdate  Action = "update"
	ActionDelete  Action = "delete"
	ActionDecrypt Action = "decrypt"
)

type Entry struct {
	PerformedBy int64
	TableSchema string
	TableName   string
	RecordID    string
	Action      Action
	OldValue    map[string]any
	NewValue    map[string]any
}

type Logger struct {
	pool *pgxpool.Pool
}

func NewLogger(pool *pgxpool.Pool) *Logger {
	return &Logger{pool: pool}
}

func (l *Logger) Log(ctx context.Context, e Entry) error {
	oldJSON, err := encodeJSON(e.OldValue)
	if err != nil {
		return err
	}
	newJSON, err := encodeJSON(e.NewValue)
	if err != nil {
		return err
	}

	return pgx.BeginTxFunc(ctx, l.pool, pgx.TxOptions{IsoLevel: pgx.Serializable}, func(tx pgx.Tx) error {
		var prevHash *string
		var prev string
		err := tx.QueryRow(ctx,
			`SELECT row_hash FROM admin_panel.write_audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE`,
		).Scan(&prev)
		if err == nil {
			prevHash = &prev
		}

		rowHash := computeHash(prevHash, e, oldJSON, newJSON)

		_, err = tx.Exec(ctx, `
			INSERT INTO admin_panel.write_audit_log
			  (performed_by, table_schema, table_name, record_id, action, old_value, new_value, prev_hash, row_hash)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`, e.PerformedBy, e.TableSchema, e.TableName, e.RecordID, string(e.Action),
			oldJSON, newJSON, prevHash, rowHash)
		return err
	})
}

func computeHash(prevHash *string, e Entry, oldJSON, newJSON []byte) string {
	h := sha256.New()
	if prevHash != nil {
		h.Write([]byte(*prevHash))
	}
	h.Write([]byte(e.TableSchema))
	h.Write([]byte{0})
	h.Write([]byte(e.TableName))
	h.Write([]byte{0})
	h.Write([]byte(e.RecordID))
	h.Write([]byte{0})
	h.Write([]byte(string(e.Action)))
	h.Write([]byte{0})
	if oldJSON != nil {
		h.Write(oldJSON)
	}
	h.Write([]byte{0})
	if newJSON != nil {
		h.Write(newJSON)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func encodeJSON(v map[string]any) ([]byte, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(v)
}
