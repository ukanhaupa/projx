import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:projx_mobile/core/auth/auth_service.dart';
import 'package:projx_mobile/core/auth/biometric_auth.dart';
import 'package:projx_mobile/core/auth/secure_storage.dart';
import 'package:projx_mobile/core/config/app_config.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('appConfigProvider builds an AppConfig from environment defaults', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(container.read(appConfigProvider), isA<AppConfig>());
  });

  test('secureStorageProvider returns a SecureStorage instance', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(container.read(secureStorageProvider), isA<SecureStorage>());
  });

  test('authServiceProvider composes secureStorage + config', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(container.read(authServiceProvider), isA<AuthService>());
  });

  test('biometricAuthProvider requires sharedPreferencesProvider override',
      () async {
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(overrides: [
      sharedPreferencesProvider.overrideWithValue(prefs),
    ]);
    addTearDown(container.dispose);
    expect(container.read(biometricAuthProvider), isA<BiometricAuth>());
  });

  test('sharedPreferencesProvider throws unless overridden', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(() => container.read(sharedPreferencesProvider),
        throwsA(isA<UnimplementedError>()));
  });

  test('isarProvider throws unless overridden', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(
        () => container.read(isarProvider), throwsA(isA<UnimplementedError>()));
  });

  group('themeModeProvider', () {
    test('defaults to light when no preference is set', () async {
      final prefs = await SharedPreferences.getInstance();
      final container = ProviderContainer(overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
      ]);
      addTearDown(container.dispose);
      expect(container.read(themeModeProvider).isDark, isFalse);
    });

    test('reads the stored value on init', () async {
      SharedPreferences.setMockInitialValues({'theme_mode': true});
      final prefs = await SharedPreferences.getInstance();
      final container = ProviderContainer(overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
      ]);
      addTearDown(container.dispose);
      expect(container.read(themeModeProvider).isDark, isTrue);
    });

    test('toggle flips the state and persists it', () async {
      final prefs = await SharedPreferences.getInstance();
      final container = ProviderContainer(overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
      ]);
      addTearDown(container.dispose);

      final notifier = container.read(themeModeProvider.notifier);
      expect(container.read(themeModeProvider).isDark, isFalse);
      notifier.toggle();
      expect(container.read(themeModeProvider).isDark, isTrue);
      expect(prefs.getBool('theme_mode'), isTrue);
      notifier.toggle();
      expect(container.read(themeModeProvider).isDark, isFalse);
    });

    test('setDark sets the explicit value', () async {
      final prefs = await SharedPreferences.getInstance();
      final container = ProviderContainer(overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
      ]);
      addTearDown(container.dispose);

      final notifier = container.read(themeModeProvider.notifier);
      notifier.setDark(true);
      expect(container.read(themeModeProvider).isDark, isTrue);
      notifier.setDark(false);
      expect(container.read(themeModeProvider).isDark, isFalse);
    });
  });
}
