-- name: GetPost :one
SELECT id, title, body, published, created_at, updated_at, deleted_at
FROM posts
WHERE id = $1 AND deleted_at IS NULL;

-- name: GetPostIncludingDeleted :one
SELECT id, title, body, published, created_at, updated_at, deleted_at
FROM posts
WHERE id = $1;

-- name: ListPosts :many
SELECT id, title, body, published, created_at, updated_at, deleted_at
FROM posts
WHERE deleted_at IS NULL
  AND (sqlc.arg('search')::text = '' OR title ILIKE '%' || sqlc.arg('search') || '%' OR body ILIKE '%' || sqlc.arg('search') || '%')
  AND (sqlc.arg('published_filter')::text = '' OR published::text = sqlc.arg('published_filter'))
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- name: CountPosts :one
SELECT COUNT(*) FROM posts
WHERE deleted_at IS NULL
  AND (sqlc.arg('search')::text = '' OR title ILIKE '%' || sqlc.arg('search') || '%' OR body ILIKE '%' || sqlc.arg('search') || '%')
  AND (sqlc.arg('published_filter')::text = '' OR published::text = sqlc.arg('published_filter'));

-- name: CreatePost :one
INSERT INTO posts (id, title, body, published, created_at, updated_at)
VALUES ($1, $2, $3, $4, NOW(), NOW())
RETURNING id, title, body, published, created_at, updated_at, deleted_at;

-- name: UpdatePost :one
UPDATE posts
SET title = COALESCE(sqlc.narg('title'), title),
    body = COALESCE(sqlc.narg('body'), body),
    published = COALESCE(sqlc.narg('published'), published),
    updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL
RETURNING id, title, body, published, created_at, updated_at, deleted_at;

-- name: SoftDeletePost :exec
UPDATE posts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL;

-- name: BulkSoftDeletePosts :exec
UPDATE posts SET deleted_at = NOW() WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL;
