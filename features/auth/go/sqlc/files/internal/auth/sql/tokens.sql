-- name: CreatePasswordResetToken :exec
INSERT INTO auth_password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
VALUES ($1, $2, $3, $4, NOW());

-- name: GetPasswordResetToken :one
SELECT id, user_id, token_hash, expires_at, used_at, created_at
FROM auth_password_reset_tokens
WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW();

-- name: MarkPasswordResetTokenUsed :exec
UPDATE auth_password_reset_tokens
SET used_at = NOW()
WHERE id = $1 AND used_at IS NULL;

-- name: DeleteExpiredPasswordResetTokens :exec
DELETE FROM auth_password_reset_tokens
WHERE expires_at < NOW();

-- name: CreateEmailVerifyToken :exec
INSERT INTO auth_email_verify_tokens (id, user_id, token_hash, expires_at, created_at)
VALUES ($1, $2, $3, $4, NOW());

-- name: GetEmailVerifyToken :one
SELECT id, user_id, token_hash, expires_at, used_at, created_at
FROM auth_email_verify_tokens
WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW();

-- name: MarkEmailVerifyTokenUsed :exec
UPDATE auth_email_verify_tokens
SET used_at = NOW()
WHERE id = $1 AND used_at IS NULL;

-- name: DeleteExpiredEmailVerifyTokens :exec
DELETE FROM auth_email_verify_tokens
WHERE expires_at < NOW();
