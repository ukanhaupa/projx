-- name: CreateSession :one
INSERT INTO auth_sessions (id, user_id, refresh_token_hash, parent_session_id, ip_address, user_agent, expires_at, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
RETURNING id, user_id, refresh_token_hash, parent_session_id, ip_address, user_agent, revoked_at, expires_at, created_at;

-- name: GetSessionByTokenHash :one
SELECT id, user_id, refresh_token_hash, parent_session_id, ip_address, user_agent, revoked_at, expires_at, created_at
FROM auth_sessions
WHERE refresh_token_hash = $1;

-- name: GetSessionByID :one
SELECT id, user_id, refresh_token_hash, parent_session_id, ip_address, user_agent, revoked_at, expires_at, created_at
FROM auth_sessions
WHERE id = $1;

-- name: GetChildSession :one
SELECT id, user_id, refresh_token_hash, parent_session_id, ip_address, user_agent, revoked_at, expires_at, created_at
FROM auth_sessions
WHERE parent_session_id = $1;

-- name: ClaimSessionForRotation :execrows
UPDATE auth_sessions
SET revoked_at = NOW()
WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeSession :exec
UPDATE auth_sessions
SET revoked_at = NOW()
WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeSessionsForUser :exec
UPDATE auth_sessions
SET revoked_at = NOW()
WHERE user_id = $1 AND revoked_at IS NULL AND id <> COALESCE(sqlc.narg('except_session_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid);

-- name: GetSessionAncestors :many
WITH RECURSIVE ancestry AS (
    SELECT id, parent_session_id FROM auth_sessions WHERE id = $1
    UNION ALL
    SELECT s.id, s.parent_session_id
    FROM auth_sessions s
    JOIN ancestry a ON s.id = a.parent_session_id
)
SELECT id FROM ancestry;

-- name: GetSessionDescendants :many
WITH RECURSIVE descendants AS (
    SELECT id, parent_session_id FROM auth_sessions WHERE id = $1
    UNION ALL
    SELECT s.id, s.parent_session_id
    FROM auth_sessions s
    JOIN descendants d ON s.parent_session_id = d.id
)
SELECT id FROM descendants;

-- name: RevokeSessionChain :exec
UPDATE auth_sessions
SET revoked_at = NOW()
WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL;

-- name: ListActiveSessionsForUser :many
SELECT id, user_id, refresh_token_hash, parent_session_id, ip_address, user_agent, revoked_at, expires_at, created_at
FROM auth_sessions
WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
ORDER BY created_at DESC;

-- name: DeleteExpiredSessions :exec
DELETE FROM auth_sessions
WHERE expires_at < NOW() - INTERVAL '7 days';
