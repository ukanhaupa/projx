# admin-panel — Go / HTMX admin (projx template)

> Stack-scoped notes. The root [`../CLAUDE.md`](../CLAUDE.md) carries cross-cutting standards — read both, they compose.
>
> This directory is a **projx template**: a working app whose own suite must stay green on the projx repo (root §"Per-template gates") **and** the source the CLI copies into scaffolded projects. It is **Docker-only** — a static binary that serves an auth-gated, read-only-by-default table browser over any Postgres reachable via `DATABASE_URL`. Meant to run internal-only behind nginx.

## Stack

- **Language** — Go (module `adminpanel`)
- **UI** — server-rendered HTMX (no JS build step)
- **DB** — connects to an arbitrary Postgres via `DATABASE_URL` (introspects, does not own a schema)
- **Auth** — session-based admin login + **mandatory TOTP 2FA** (`internal/auth`), argon2id recovery codes, per-admin lockout
- **Secrets** — `internal/secret` decrypts encrypted `service_configs` cells (AES-256-GCM, matches the fastify writer format), write-permission-gated, never logged

## Layout

| Path                                | What it holds                                                       |
| ----------------------------------- | ------------------------------------------------------------------- |
| `cmd/admin/`                        | Entrypoint (`main`) — excluded from coverage                        |
| `internal/auth/`                    | Login, session, mandatory TOTP 2FA + recovery codes, lockout        |
| `internal/browser/`                 | Postgres introspection + read-only (default) table browser          |
| `internal/secret/`                  | Write-gated `service_configs` decryption (Node-format cross-compat) |
| `internal/audit/`                   | Audit-log writes (decrypt action is logged-but-not-plaintext)       |
| `internal/{config,db,web,testenv}/` | Config, pool, HTMX handlers/templates, test harness                 |
| `scripts/`                          | `check-coverage.sh`, `check-gofmt.sh`, `test.sh`                    |

## Quality gates (root §"Per-template gates")

`gofmt` (via `scripts/check-gofmt.sh`) → `go vet ./...` → `go build ./...` → `go test ./...` (real Postgres; integration suite self-skips when `TEST_DATABASE_URL` is unset) → `bash scripts/check-coverage.sh` (≥80%, entrypoint excluded). Locally `bash ../scripts/ci-local.sh admin_panel`.

## Things that bite

- **Read-only by default** — write mode is an explicit, server-side-rechecked permission. The Decrypt affordance only renders for write-mode admins; read-only admins get a 403 even on a hand-crafted request. Never move the gate into hidden UI.
- **2FA is mandatory and server-enforced** (`admin_sessions.mfa_passed` + `admin_users.totp_enrolled_at`) — a password-only session is held in the forced-enrolment flow; recovery codes are consumed atomically (no replay).
- **Decryption key is bootstrap-only** (`CRED_ENCRYPTION_KEY`, base64 → 32 bytes); when unset the Decrypt action never renders and the route returns 503.
- **Docker-only** — there is no local dev server story; build the image and run it against a Postgres.
