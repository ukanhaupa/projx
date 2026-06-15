# mobile — Flutter app (projx template)

> Stack-scoped notes. The root [`../CLAUDE.md`](../CLAUDE.md) carries cross-cutting standards — read both, they compose.
>
> This directory is a **projx template**: a working app whose own suite must stay green on the projx repo (root §"Per-template gates") **and** the source the CLI copies into scaffolded projects.

## Stack

- **Framework** — Flutter `>=3.16`, Dart `>=3.2 <4`
- **State** — Riverpod (`flutter_riverpod` + `riverpod_annotation`/`riverpod_generator`); providers are the DI surface
- **Routing** — `go_router`
- **Networking** — `dio` with interceptors
- **Models** — `freezed`
- **Secure storage** — `flutter_secure_storage` (Keychain/Keystore)
- **i18n** — ARB pipeline (`lib/l10n/`, `l10n.yaml`)
- **Test** — `flutter_test` (unit + widget); coverage via `scripts/check-coverage.sh`

## Layout

| Path                                         | What it holds                                                       |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `lib/main.dart`, `lib/app.dart`              | `ProviderScope` + `MaterialApp.router`, theme/router/i18n wiring    |
| `lib/core/auth/`                             | `auth_service`, `auth_state`, `secure_storage`, `biometric_auth`    |
| `lib/core/network/`                          | `auth_interceptor`, `logging_interceptor`, `retry_interceptor`      |
| `lib/core/errors/`                           | `app_exception.dart`, `error_handler.dart`                          |
| `lib/core/theme/`                            | `color_tokens`, `spacing`, `typography`, `shadows`, `app_theme`     |
| `lib/core/routing/`                          | `router.dart`, `routes.dart` (go_router)                            |
| `lib/core/{config,providers,notifications}/` | App config/constants, Riverpod providers, push notifications        |
| `lib/features/`                              | `auth`, `dashboard`, `offline`, `settings` — one folder per feature |
| `lib/shared/`                                | `widgets/` (design-system widgets), `extensions/`                   |
| `lib/l10n/`                                  | ARB + generated localizations                                       |
| `test/unit/`, `test/widget/`                 | Unit + widget tests                                                 |
| `scripts/check-coverage.sh`                  | Coverage gate (≥80%)                                                |

## Error contract — mirrors the backend

`lib/core/errors/error_handler.dart` parses the backend's `{ detail, request_id }` and maps status codes to `AppException` subclasses (`UnauthorizedException`, `ServerException`, …), carrying `requestId` through to UI/support. Keep this in lockstep with the backends' error shape (root §"Error handling is centralized").

## Conventions

- **State** flows through Riverpod `ref` — no global singletons reached via imports. Override providers in tests to inject fakes.
- **Theme**: widgets read tokens (`color_tokens`, `spacing`, `typography`), never raw `Color(0xFF…)` / raw sizes. Dark is a distinct register (root §"CSS discipline" applies in Dart too).
- **Networking**: all HTTP goes through the `dio` client + interceptors; features call typed wrappers, not raw `dio.get`.
- **Secure storage**: tokens in `flutter_secure_storage`, never `SharedPreferences`.
- **i18n**: user-facing strings via the ARB catalog, not hardcoded.

## Testing

Current suite is unit (`test/unit/`) + widget (`test/widget/`). When adding a screen, add widget coverage; goldens + integration flows belong here per root §"Test pyramid" — add the scaffolding (`test/goldens/`, `integration_test/`) with the first screen that needs them rather than skipping the layer.

## Quality gates (root §"Per-template gates")

`dart format .` → `dart analyze --fatal-infos` → `flutter test --coverage` → `bash scripts/check-coverage.sh` (≥80%). Green or not done.
