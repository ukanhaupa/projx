# Projx -- Flutter Mobile

Cross-platform mobile app (iOS + Android) shell built with Flutter, Riverpod, and GoRouter. Ships with auth, biometric, theming, and a routed app scaffold. Build your screens on top.

## Quick Start

### Prerequisites

- Flutter SDK 3.24+ (`flutter --version`)
- iOS: Xcode 15+, CocoaPods
- Android: Android Studio with API 34 SDK

### Install

```bash
cd mobile
flutter pub get
```

### Configure

Copy `.env.example` to `.env` and set:

```
API_BASE_URL=http://10.0.2.2:8000   # Android emulator → host
FCM_ENABLED=false                    # set true once you wire FCM
```

### Run

```bash
flutter run                 # connected device / simulator
flutter run -d chrome       # web
```

## Project Structure

```
lib/
├── main.dart                       # Entry: Riverpod container, push notifications, runApp
├── app.dart                        # MaterialApp.router with theme + GoRouter
├── core/
│   ├── config/                     # AppConfig, ApiPaths, StorageKeys, Pagination constants
│   ├── routing/
│   │   ├── routes.dart             # Route path constants (login, splash, dashboard, settings)
│   │   └── router.dart             # GoRouter builder with auth redirect
│   ├── auth/                       # AuthService + SecureStorage + BiometricAuth
│   ├── notifications/              # FCM-backed push notification service
│   ├── network/                    # Dio + interceptors (AuthInterceptor, RetryInterceptor, LoggingInterceptor)
│   ├── providers/                  # core_providers.dart — Riverpod providers
│   └── theme/                      # ColorTokens, Spacing, AppTheme (light + dark)
├── features/
│   ├── auth/                       # LoginScreen, SplashScreen
│   ├── dashboard/                  # DashboardScreen — replace with your landing page
│   ├── settings/                   # SettingsScreen
│   └── offline/                    # SyncIndicator (online/offline badge)
├── shared/
│   └── widgets/                    # AppScaffold (drawer + bottom nav), reusable widgets
test/
├── unit/                           # Pure logic tests
└── widget/                         # Widget tests
```

## Wiring Your Own Screens

1. Add a screen under `lib/features/`.
2. Register the route in `lib/core/routing/router.dart` as a child of the shell:

   ```dart
   GoRoute(
     path: '/invoices',
     builder: (_, __) => const InvoicesScreen(),
   ),
   ```

3. Add a nav entry in `lib/shared/widgets/app_scaffold.dart` (drawer + bottom nav).
4. Use Dio via the providers in `core/providers/core_providers.dart` for HTTP calls — `AuthInterceptor` adds Authorization headers automatically.

## Generated Models

`projx gen entity <name>` writes a Dart model class with `fromJson`, `toJson`, and `copyWith` into `lib/entities/<name>/model.dart` (path is created on demand). Import them when consuming your API.

## Auth

`AuthService` handles OIDC. On login, tokens are stored in `flutter_secure_storage` and `AuthInterceptor` adds them to every Dio request. `SplashScreen` resolves the auth state and routes to either `LoginScreen` or `DashboardScreen`.

Biometric unlock is optional — `BiometricAuth` reads/writes a `biometric_enabled` flag in `SharedPreferences` and prompts via `local_auth`.

## Testing

```bash
flutter test                       # unit + widget tests
flutter test --coverage            # with lcov coverage report
bash scripts/check-coverage.sh     # enforce 80% threshold
```

## Linting & Formatting

```bash
dart format .
dart analyze --fatal-infos
```
