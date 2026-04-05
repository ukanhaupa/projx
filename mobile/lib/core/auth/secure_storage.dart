import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:projx_mobile/core/config/constants.dart';

class SecureStorage {
  final FlutterSecureStorage _storage;

  SecureStorage({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  Future<String?> getAccessToken() =>
      _storage.read(key: StorageKeys.accessToken);

  Future<void> setAccessToken(String token) =>
      _storage.write(key: StorageKeys.accessToken, value: token);

  Future<String?> getRefreshToken() =>
      _storage.read(key: StorageKeys.refreshToken);

  Future<void> setRefreshToken(String token) =>
      _storage.write(key: StorageKeys.refreshToken, value: token);

  Future<String?> getIdToken() => _storage.read(key: StorageKeys.idToken);

  Future<void> setIdToken(String token) =>
      _storage.write(key: StorageKeys.idToken, value: token);

  Future<void> setTokens({
    required String accessToken,
    required String refreshToken,
    String? idToken,
  }) async {
    await Future.wait([
      setAccessToken(accessToken),
      setRefreshToken(refreshToken),
      if (idToken != null) setIdToken(idToken),
    ]);
  }

  Future<void> clearTokens() async {
    await Future.wait([
      _storage.delete(key: StorageKeys.accessToken),
      _storage.delete(key: StorageKeys.refreshToken),
      _storage.delete(key: StorageKeys.idToken),
    ]);
  }

  Future<bool> hasTokens() async {
    final token = await getAccessToken();
    return token != null && token.isNotEmpty;
  }
}
