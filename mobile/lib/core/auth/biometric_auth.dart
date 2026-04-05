import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:projx_mobile/core/config/constants.dart';

class BiometricAuth {
  final LocalAuthentication _localAuth;
  final SharedPreferences _prefs;

  BiometricAuth({
    required SharedPreferences prefs,
    LocalAuthentication? localAuth,
  })  : _prefs = prefs,
        _localAuth = localAuth ?? LocalAuthentication();

  Future<bool> isAvailable() async {
    final canCheck = await _localAuth.canCheckBiometrics;
    final isDeviceSupported = await _localAuth.isDeviceSupported();
    return canCheck && isDeviceSupported;
  }

  Future<List<BiometricType>> getAvailableTypes() =>
      _localAuth.getAvailableBiometrics();

  bool get isEnabled => _prefs.getBool(StorageKeys.biometricEnabled) ?? false;

  Future<void> setEnabled(bool enabled) =>
      _prefs.setBool(StorageKeys.biometricEnabled, enabled);

  Future<bool> authenticate({
    String reason = 'Authenticate to continue',
  }) async {
    if (!isEnabled) return true;
    if (!await isAvailable()) return true;

    return _localAuth.authenticate(
      localizedReason: reason,
      options: const AuthenticationOptions(
        stickyAuth: true,
        biometricOnly: true,
      ),
    );
  }
}
