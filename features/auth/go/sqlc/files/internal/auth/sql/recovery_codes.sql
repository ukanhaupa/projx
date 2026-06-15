-- name: CreateRecoveryCode :exec
INSERT INTO auth_recovery_codes (id, user_id, code_hash, created_at)
VALUES ($1, $2, $3, NOW());

-- name: GetUnusedRecoveryCodes :many
SELECT id, user_id, code_hash, used_at, created_at
FROM auth_recovery_codes
WHERE user_id = $1 AND used_at IS NULL;

-- name: MarkRecoveryCodeUsed :exec
UPDATE auth_recovery_codes
SET used_at = NOW()
WHERE id = $1 AND used_at IS NULL;

-- name: DeleteRecoveryCodesForUser :exec
DELETE FROM auth_recovery_codes WHERE user_id = $1;
