import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:isar/isar.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:projx_mobile/core/auth/auth_service.dart';
import 'package:projx_mobile/core/auth/biometric_auth.dart';
import 'package:projx_mobile/core/auth/secure_storage.dart';
import 'package:projx_mobile/core/config/app_config.dart';
import 'package:projx_mobile/core/network/api_client.dart';
import 'package:projx_mobile/core/network/auth_interceptor.dart';
import 'package:projx_mobile/core/network/logging_interceptor.dart';
import 'package:projx_mobile/core/network/retry_interceptor.dart';
import 'package:projx_mobile/entities/base/offline/sync_service.dart';

final appConfigProvider = Provider<AppConfig>((ref) {
  return AppConfig.fromEnvironment();
});

final sharedPreferencesProvider = Provider<SharedPreferences>((ref) {
  throw UnimplementedError(
    'Must be overridden with actual SharedPreferences instance',
  );
});

final isarProvider = Provider<Isar>((ref) {
  throw UnimplementedError('Must be overridden with actual Isar instance');
});

final secureStorageProvider = Provider<SecureStorage>((ref) {
  return SecureStorage();
});

final authServiceProvider = Provider<AuthService>((ref) {
  return AuthService(
    storage: ref.watch(secureStorageProvider),
    config: ref.watch(appConfigProvider),
  );
});

final biometricAuthProvider = Provider<BiometricAuth>((ref) {
  return BiometricAuth(prefs: ref.watch(sharedPreferencesProvider));
});

final dioProvider = Provider<Dio>((ref) {
  final config = ref.watch(appConfigProvider);
  final storage = ref.watch(secureStorageProvider);
  final authService = ref.watch(authServiceProvider);

  final dio = Dio(
    BaseOptions(
      baseUrl: config.apiBaseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ),
  );

  dio.interceptors.addAll([
    AuthInterceptor(storage, authService),
    RetryInterceptor(),
    LoggingInterceptor(),
  ]);

  return dio;
});

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(dio: ref.watch(dioProvider));
});

final authStateProvider = FutureProvider<bool>((ref) async {
  final authService = ref.watch(authServiceProvider);
  return authService.isAuthenticated();
});

final connectivityProvider = StreamProvider<List<ConnectivityResult>>((ref) {
  return Connectivity().onConnectivityChanged;
});

final isOnlineProvider = Provider<bool>((ref) {
  final connectivity = ref.watch(connectivityProvider);
  return connectivity.when(
    data: (results) => !results.contains(ConnectivityResult.none),
    loading: () => true,
    error: (_, __) => true,
  );
});

final syncServiceProvider = Provider<SyncService>((ref) {
  return SyncService(
    apiClient: ref.watch(apiClientProvider),
    isar: ref.watch(isarProvider),
  );
});

final themeModeProvider =
    StateNotifierProvider<ThemeModeNotifier, ThemeModeState>((ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  return ThemeModeNotifier(prefs);
});

class ThemeModeState {
  final bool isDark;
  const ThemeModeState({required this.isDark});
}

class ThemeModeNotifier extends StateNotifier<ThemeModeState> {
  final SharedPreferences _prefs;

  ThemeModeNotifier(this._prefs)
      : super(ThemeModeState(isDark: _prefs.getBool('theme_mode') ?? false));

  void toggle() {
    final newValue = !state.isDark;
    _prefs.setBool('theme_mode', newValue);
    state = ThemeModeState(isDark: newValue);
  }

  void setDark(bool isDark) {
    _prefs.setBool('theme_mode', isDark);
    state = ThemeModeState(isDark: isDark);
  }
}
