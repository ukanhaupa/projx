# Projx -- Flutter Mobile

Cross-platform mobile app (iOS + Android) built with Flutter, Riverpod, and GoRouter. The app uses **auto-entity discovery**: it fetches entity metadata from the backend `/_meta` endpoint at startup and generates list, detail, and form screens automatically -- no per-entity code required. All data is cached locally with Isar for offline-first operation.

## Quick Start

### Prerequisites

- Flutter SDK >= 3.16.0 (Dart >= 3.2.0)
- Xcode (iOS) or Android Studio (Android)
- A running backend with the `/_meta` endpoint (see the `backend/` template)

### Setup

```bash
cp .env.example .env        # review and adjust values
flutter pub get
dart run build_runner build  # generate Isar schemas + Freezed models
flutter run
```

### Environment Variables

Variables are injected via `--dart-define` at build time. Defaults are set in `lib/core/config/app_config.dart`.

| Variable                | Default                                   | Description                                        |
| ----------------------- | ----------------------------------------- | -------------------------------------------------- |
| `API_BASE_URL`          | `http://localhost:8000`                   | Backend API base URL                               |
| `OIDC_REALM_URL`    | `http://localhost:8080/realms/my-project` | OIDC realm URL                                     |
| `OIDC_CLIENT_ID`    | `mobile-app`                              | OIDC client ID                                     |
| `OIDC_REDIRECT_URI` | `com.example.app://callback`              | OIDC redirect URI (deep link)                      |
| `FCM_ENABLED`           | `false`                                   | Enable Firebase Cloud Messaging push notifications |

Example with overrides:

```bash
flutter run \
  --dart-define=API_BASE_URL=https://api.staging.example.com \
  --dart-define=OIDC_REALM_URL=https://auth.example.com/realms/my-project \
  --dart-define=OIDC_CLIENT_ID=mobile-app \
  --dart-define=OIDC_REDIRECT_URI=com.example.app://callback
```

## Project Structure

```
lib/
├── main.dart                          # Entry point: Isar init, provider overrides, FCM setup
├── app.dart                           # MaterialApp.router with theme + GoRouter
├── core/
│   ├── config/app_config.dart         # Reads --dart-define env vars
│   ├── auth/
│   │   ├── auth_service.dart          # OIDC login/logout/refresh (flutter_appauth)
│   │   ├── secure_storage.dart        # Encrypted token storage (flutter_secure_storage)
│   │   └── biometric_auth.dart        # Fingerprint / Face ID unlock (local_auth)
│   ├── network/
│   │   ├── api_client.dart            # Dio HTTP client with pagination support
│   │   └── auth_interceptor.dart      # Token injection + 401 auto-refresh
│   ├── providers/core_providers.dart  # Root Riverpod providers (Isar, SharedPrefs, auth state)
│   ├── routing/router.dart            # GoRouter with auth redirect guard
│   ├── theme/                         # Material 3 light + dark themes, color tokens, spacing
│   ├── errors/                        # AppException hierarchy + ErrorHandler
│   └── notifications/                 # FCM push notification service
├── entities/
│   ├── base/
│   │   ├── entity_config.dart         # EntityConfig + FieldConfig models (slug, fields, types)
│   │   ├── entity_providers.dart      # Riverpod providers: configs, list, detail, service, repo
│   │   ├── meta_parser.dart           # Parses /_meta JSON into EntityConfig list
│   │   ├── base_repository.dart       # Generic CRUD repo with Isar cache + offline queue
│   │   ├── base_service.dart          # Business logic layer (delegates to repository)
│   │   ├── query_params.dart          # Builds query params for search, filter, sort, expand
│   │   └── offline/
│   │       ├── cached_entity.dart     # Isar schema for cached entity JSON
│   │       ├── pending_mutation.dart   # Isar schema for queued offline mutations
│   │       └── sync_service.dart      # Connectivity listener + mutation replay
│   ├── entity_overrides.dart          # Per-entity UI customization (icon, builders, page size)
│   └── entity_registry.dart           # StateNotifier holding slug -> EntityConfig map
├── features/
│   ├── auth/                          # SplashScreen, LoginScreen
│   ├── dashboard/                     # DashboardScreen (entity card grid)
│   ├── entity/
│   │   ├── entity_list_screen.dart    # Paginated list with search + filter sheet
│   │   ├── entity_detail_screen.dart  # Field-by-field detail view
│   │   ├── entity_form_screen.dart    # Auto-generated create/edit form
│   │   └── widgets/                   # EntityField, EntityFilterSheet, EntityListTile, SearchBar
│   ├── settings/                      # Theme toggle, biometrics, logout
│   └── offline/                       # SyncIndicator widget (pending mutation count)
└── shared/widgets/                    # AppScaffold, Avatar, ConfirmDialog, EmptyState,
                                       # ErrorState, LoadingIndicator, Toast
```

## Auto-Entity Pattern

The core idea: the backend exposes a `/_meta` endpoint that describes every entity (slug, fields, types, constraints). The mobile app fetches this once at startup and builds all CRUD screens from the metadata.

### How It Works

1. **Fetch metadata** -- `entityConfigsProvider` calls `GET /_meta` and passes the JSON through `MetaParser.parse()`, producing a `List<EntityConfig>`.
2. **Register entities** -- The parsed configs are stored in `EntityRegistryNotifier`, a Riverpod `StateNotifier<Map<String, EntityConfig>>`.
3. **Render screens** -- `EntityListScreen`, `EntityDetailScreen`, and `EntityFormScreen` all accept a `slug` parameter. They look up the `EntityConfig` for that slug and render fields dynamically based on `FieldConfig.fieldType` (text, number, date, datetime, textarea, boolean, select).
4. **Override defaults** -- Use `EntityOverrides.register()` to customize icon, page size, sort order, or supply entirely custom builders for list tiles, detail views, or forms.

### EntityConfig Model

```dart
EntityConfig(
  slug: 'products',           // URL-safe identifier
  name: 'Product',            // Singular display name
  namePlural: 'Products',     // Plural display name
  fields: [FieldConfig(...)], // Field definitions
  softDelete: false,          // Whether DELETE is soft
  searchableFields: ['name'], // Fields included in search
)
```

### Customizing an Entity

```dart
EntityOverrides.register('products', const EntityOverride(
  icon: Icons.shopping_bag_outlined,
  pageSize: 50,
  defaultOrderBy: '-created_at',
  listExpandFields: ['category'],
));
```

You can also provide fully custom widget builders via `listTileBuilder`, `detailBuilder`, and `formBuilder`.

## Architecture

The app follows **Clean Architecture** layered with Riverpod for dependency injection and state management:

```
Screen (Widget)
  -> Riverpod Provider (state + async)
    -> BaseService (business logic)
      -> BaseRepository (data access + cache)
        -> ApiClient (HTTP via Dio)
        -> Isar (local cache + offline queue)
```

- **Screens** are stateless widgets that `watch` Riverpod providers.
- **Providers** (`entity_providers.dart`) are parameterized by entity slug using `Provider.family`.
- **BaseService** is a thin pass-through today; it is the place to add validation, transformations, or entity-specific business rules.
- **BaseRepository** handles the online/offline split: it tries the API first, caches successful responses in Isar, and falls back to the Isar cache when the network is unavailable.

### Routing

GoRouter with auth-aware redirect. Routes:

| Path                       | Screen                    |
| -------------------------- | ------------------------- |
| `/`                        | SplashScreen (auth check) |
| `/login`                   | LoginScreen               |
| `/dashboard`               | DashboardScreen           |
| `/settings`                | SettingsScreen            |
| `/entities/:slug`          | EntityListScreen          |
| `/entities/:slug/new`      | EntityFormScreen (create) |
| `/entities/:slug/:id`      | EntityDetailScreen        |
| `/entities/:slug/:id/edit` | EntityFormScreen (edit)   |

All routes after login are wrapped in an `AppScaffold` shell.

## Offline Support

Offline-first is built into `BaseRepository` and backed by Isar (a fast, embedded NoSQL database).

### Read Path

When the device is offline, list and detail queries return data from the local Isar cache. Every successful API response is cached automatically.

### Write Path (Mutation Queue)

When a create, update, or delete fails due to network issues, the mutation is saved as a `PendingMutation` in Isar. Fields stored: `entitySlug`, `method` (POST/PATCH/DELETE), `remoteId`, `jsonData`, `createdAt`, `retryCount`.

### Sync

`SyncService` listens to `connectivity_plus` for network state changes. When connectivity is restored, it replays all pending mutations in FIFO order. Mutations are retried up to 5 times. Permanent errors (validation, 403, 404, 409) are discarded immediately to avoid infinite retries.

The `SyncIndicator` widget displays the count of pending mutations so the user knows when changes are still queued.

## Authentication

Authentication uses **OIDC** via `flutter_appauth`.

- **Login**: `AuthService.login()` opens the system browser for the OIDC authorization code flow, exchanges the code for tokens, and stores them in `flutter_secure_storage`.
- **Token refresh**: `AuthInterceptor` automatically refreshes expired access tokens on 401 responses.
- **Logout**: Ends the OIDC session and clears stored tokens.
- **Biometric unlock**: Optional fingerprint / Face ID gate via `local_auth`.
## Theming

Material 3 with full light and dark theme support.

- Themes are defined in `lib/core/theme/app_theme.dart` using `ColorScheme.fromSeed()` with custom color token overrides.
- Color tokens live in `lib/core/theme/color_tokens.dart` (separate light/dark palettes).
- Spacing constants and border radii are in `lib/core/theme/spacing.dart`.
- Typography uses `google_fonts` via `lib/core/theme/typography.dart`.
- Theme mode is toggled from the Settings screen and persisted via `SharedPreferences`.

## Testing

### Test Structure

```
test/
├── unit/
│   ├── core/              # api_client, base_repository, error_handler, query_params, string_extensions
│   └── entities/          # entity_config, meta_parser, sync_service
└── widget/
    ├── features/          # dashboard, entity list/detail/form, filter sheet, login, settings
    └── shared/            # avatar, confirm_dialog, empty_state
integration_test/          # Full app integration tests
```

### Running Tests

```bash
# Unit + widget tests
flutter test

# With coverage
flutter test --coverage

# Integration tests (requires emulator or device)
flutter test integration_test/

# Single test file
flutter test test/unit/entities/meta_parser_test.dart
```

## Code Generation

The project uses `build_runner` for:

- **Isar schemas** (`cached_entity.g.dart`, `pending_mutation.g.dart`) -- generated from `@Collection()` annotations
- **Freezed** models -- immutable data classes with `copyWith` and JSON serialization
- **Riverpod generators** -- `@riverpod` annotated providers
- **JSON serialization** -- `@JsonSerializable` classes

Run code generation after modifying any annotated class:

```bash
dart run build_runner build --delete-conflicting-outputs
```

For continuous generation during development:

```bash
dart run build_runner watch --delete-conflicting-outputs
```

## Build

```bash
# Android APK
flutter build apk --release

# Android App Bundle (Play Store)
flutter build appbundle --release

# iOS (requires Xcode + signing)
flutter build ios --release
```

## Key Dependencies

| Package                         | Purpose                                 |
| ------------------------------- | --------------------------------------- |
| `flutter_riverpod`              | State management + dependency injection |
| `go_router`                     | Declarative routing with auth guards    |
| `dio`                           | HTTP client with interceptors           |
| `flutter_appauth`               | OIDC authentication                     |
| `flutter_secure_storage`        | Encrypted token storage                 |
| `local_auth`                    | Biometric authentication                |
| `isar` / `isar_flutter_libs`    | Local NoSQL database for offline cache  |
| `connectivity_plus`             | Network state monitoring                |
| `firebase_messaging`            | Push notifications (FCM)                |
| `flutter_local_notifications`   | Local notification display              |
| `google_fonts`                  | Typography                              |
| `shimmer`                       | Loading skeleton animations             |
| `freezed` / `json_serializable` | Immutable models + JSON codegen         |
