# laravel — Laravel / PHP backend (projx template)

> Stack-scoped notes. The root [`../CLAUDE.md`](../CLAUDE.md) carries cross-cutting standards — read both, they compose.
>
> This directory is a **projx template**: a working backend whose own suite must stay green on the projx repo (root §"Per-template gates") **and** the source the CLI copies into scaffolded projects. Same runtime surface as the sibling backends (auto-CRUD, `{detail, request_id}` envelope, soft-delete, lifecycle hooks) with Laravel idioms.

## Stack

- **Language** — PHP 8.3+ (CI pins 8.3 via `shivammathur/setup-php`)
- **Framework** — Laravel 12 (slim skeleton: `bootstrap/app.php` configure pattern)
- **ORM / DB** — Eloquent + Postgres (`eloquent` is the canonical PHP ORM)
- **Auth** — Sanctum-ready; JWT via `firebase/php-jwt` ^7 (`app/Services/JwtVerifier.php`)
- **Config** — DB-backed encrypted `service_configs` (`app/Services/ServiceConfig.php`), env bootstrap-only
- **Errors** — `app/Exceptions/Handler.php` renders `{detail, request_id}` for `api/*`
- **Runtime** — FrankenPHP (single-binary HTTP), multi-stage `Dockerfile`
- **Test** — Pest 3 (PHPUnit 11 under it); static analysis Larastan 3 (PHPStan level 8); format Pint

## Layout

| Path                                         | What it holds                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `bootstrap/app.php`                          | `Application::configure()` — routing, middleware (`RequestId`, Sanctum), exceptions        |
| `bootstrap/cache/`                           | Compiled-container cache dir (must exist for boot — keep the `.gitignore`)                 |
| `app/Http/Middleware/`                       | `RequestId.php`, auth/authz, CORS, per-user rate-limit                                     |
| `app/Exceptions/`                            | `Handler.php`, `AppException` subclasses (status-carrying)                                 |
| `app/Services/`                              | `JwtVerifier.php`, `ServiceConfig.php` (AES-256-GCM, cross-language wire-format)           |
| `app/Entities/`                              | `EntityRegistry.php`, `EntityConfig.php`, `AutoRoutesController.php`, `QueryBuilder.php`   |
| `app/Models/`                                | `User.php`, `ServiceConfig.php`, example `Post`                                            |
| `app/Providers/`                             | `AppServiceProvider.php` (`// projx-anchor: providers`), `EntityServiceProvider.php`       |
| `routes/api.php`                             | `/api/v1` mount + `// projx-anchor: routes`                                                |
| `database/migrations/`                       | `service_configs` + `posts` (schema, not pre-baked app migrations)                         |
| `tests/`                                     | Pest `Unit/` (JwtVerifier, RequestId, Cors, RateLimit, ServiceConfig, Authenticate, Authz) |
| `phpstan.neon` / `pint.json` / `phpunit.xml` | Gate configs                                                                               |

## Quality gates (root §"Per-template gates")

`composer install` → `./vendor/bin/pint --test` → `./vendor/bin/phpstan analyse --level=8` → `./vendor/bin/pest --coverage --min=80` (coverage via pcov). Locally `bash ../scripts/ci-local.sh laravel` (skips cleanly when php/composer absent).

## Things that bite

- **`composer install` does a fresh `composer update`** (no lock shipped to scaffolds) — version constraints must resolve clean. Composer 2.8+ **blocks advisory-affected versions by default**; keep deps on actively-patched majors (Laravel 12, `firebase/php-jwt` ^7) or resolution fails before any gate runs.
- **`bootstrap/cache/` must exist** or `artisan package:discover` (a post-autoload-dump script) fails. The dir ships with a `.gitignore` (`*` except itself).
- **`strict_types=1`** at the top of every PHP file; type + return declarations everywhere (PHPStan level 8 enforces).
- **Runtime creds are DB-backed** (`service_configs`); env is bootstrap-only — JWT secret reads go through `ServiceConfig`, not `env()`.
- **`--auth=laravel`** overlays the full auth feature from [`../features/auth/laravel/`](../features/auth/laravel/).
