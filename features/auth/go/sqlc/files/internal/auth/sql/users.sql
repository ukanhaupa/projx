-- name: GetUserByID :one
SELECT id, email, password_hash, name, role, mfa_enabled, mfa_secret, email_verified_at,
       failed_attempts, locked_until, last_login_at, created_at, updated_at, deleted_at
FROM auth_users
WHERE id = $1 AND deleted_at IS NULL;

-- name: GetUserByEmail :one
SELECT id, email, password_hash, name, role, mfa_enabled, mfa_secret, email_verified_at,
       failed_attempts, locked_until, last_login_at, created_at, updated_at, deleted_at
FROM auth_users
WHERE email = $1 AND deleted_at IS NULL;

-- name: CountUsers :one
SELECT COUNT(*) FROM auth_users WHERE deleted_at IS NULL;

-- name: CreateUser :one
INSERT INTO auth_users (id, email, password_hash, name, role, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
RETURNING id, email, password_hash, name, role, mfa_enabled, mfa_secret, email_verified_at,
          failed_attempts, locked_until, last_login_at, created_at, updated_at, deleted_at;

-- name: UpdateUserPassword :exec
UPDATE auth_users
SET password_hash = $2, updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL;

-- name: UpdateUserLastLogin :exec
UPDATE auth_users
SET last_login_at = NOW(), failed_attempts = 0, locked_until = NULL, updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL;

-- name: RecordLoginFailure :one
UPDATE auth_users
SET failed_attempts = failed_attempts + 1,
    locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN NOW() + ($3 || ' minutes')::interval ELSE locked_until END,
    updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL
RETURNING failed_attempts, locked_until;

-- name: SetUserMFA :exec
UPDATE auth_users
SET mfa_enabled = $2, mfa_secret = $3, updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL;

-- name: MarkEmailVerified :exec
UPDATE auth_users
SET email_verified_at = NOW(), updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL;
