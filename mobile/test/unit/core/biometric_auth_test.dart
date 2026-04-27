import 'package:flutter_test/flutter_test.dart';
import 'package:local_auth/local_auth.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:projx_mobile/core/auth/biometric_auth.dart';

class MockLocalAuth extends Mock implements LocalAuthentication {}

void main() {
  setUpAll(() {
    registerFallbackValue(const AuthenticationOptions());
  });

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('isEnabled defaults to false when no preference is set', () async {
    final prefs = await SharedPreferences.getInstance();
    final auth = BiometricAuth(prefs: prefs, localAuth: MockLocalAuth());

    expect(auth.isEnabled, isFalse);
  });

  test('setEnabled persists to SharedPreferences and isEnabled reflects it',
      () async {
    final prefs = await SharedPreferences.getInstance();
    final auth = BiometricAuth(prefs: prefs, localAuth: MockLocalAuth());

    await auth.setEnabled(true);
    expect(auth.isEnabled, isTrue);

    await auth.setEnabled(false);
    expect(auth.isEnabled, isFalse);
  });

  test(
      'isAvailable returns true when canCheckBiometrics and isDeviceSupported are both true',
      () async {
    final localAuth = MockLocalAuth();
    when(() => localAuth.canCheckBiometrics).thenAnswer((_) async => true);
    when(() => localAuth.isDeviceSupported()).thenAnswer((_) async => true);

    final prefs = await SharedPreferences.getInstance();
    final auth = BiometricAuth(prefs: prefs, localAuth: localAuth);

    expect(await auth.isAvailable(), isTrue);
  });

  test('isAvailable returns false when device is not supported', () async {
    final localAuth = MockLocalAuth();
    when(() => localAuth.canCheckBiometrics).thenAnswer((_) async => true);
    when(() => localAuth.isDeviceSupported()).thenAnswer((_) async => false);

    final prefs = await SharedPreferences.getInstance();
    final auth = BiometricAuth(prefs: prefs, localAuth: localAuth);

    expect(await auth.isAvailable(), isFalse);
  });

  test('getAvailableTypes delegates to LocalAuthentication', () async {
    final localAuth = MockLocalAuth();
    when(() => localAuth.getAvailableBiometrics())
        .thenAnswer((_) async => [BiometricType.face]);

    final prefs = await SharedPreferences.getInstance();
    final auth = BiometricAuth(prefs: prefs, localAuth: localAuth);

    expect(await auth.getAvailableTypes(), [BiometricType.face]);
  });

  test('authenticate returns true without calling auth when not enabled',
      () async {
    final localAuth = MockLocalAuth();
    final prefs = await SharedPreferences.getInstance();
    final auth = BiometricAuth(prefs: prefs, localAuth: localAuth);

    expect(await auth.authenticate(), isTrue);
    verifyNever(() => localAuth.authenticate(
          localizedReason: any(named: 'localizedReason'),
          options: any(named: 'options'),
        ));
  });

  test(
      'authenticate returns true (skipping prompt) when biometrics unavailable',
      () async {
    SharedPreferences.setMockInitialValues({'biometric_enabled': true});
    final localAuth = MockLocalAuth();
    when(() => localAuth.canCheckBiometrics).thenAnswer((_) async => false);
    when(() => localAuth.isDeviceSupported()).thenAnswer((_) async => false);

    final prefs = await SharedPreferences.getInstance();
    final auth = BiometricAuth(prefs: prefs, localAuth: localAuth);

    expect(await auth.authenticate(), isTrue);
  });

  test('authenticate calls LocalAuthentication when enabled and available',
      () async {
    SharedPreferences.setMockInitialValues({'biometric_enabled': true});
    final localAuth = MockLocalAuth();
    when(() => localAuth.canCheckBiometrics).thenAnswer((_) async => true);
    when(() => localAuth.isDeviceSupported()).thenAnswer((_) async => true);
    when(() => localAuth.authenticate(
          localizedReason: any(named: 'localizedReason'),
          options: any(named: 'options'),
        )).thenAnswer((_) async => true);

    final prefs = await SharedPreferences.getInstance();
    final auth = BiometricAuth(prefs: prefs, localAuth: localAuth);

    expect(await auth.authenticate(reason: 'Unlock me'), isTrue);
    verify(() => localAuth.authenticate(
          localizedReason: 'Unlock me',
          options: any(named: 'options'),
        )).called(1);
  });
}
