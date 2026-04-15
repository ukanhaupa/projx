import 'dart:convert';

import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:projx_mobile/core/auth/secure_storage.dart';
import 'package:projx_mobile/core/config/app_config.dart';

class AuthService {
  final FlutterAppAuth _appAuth;
  final SecureStorage _storage;
  final AppConfig _config;

  AuthService({
    required SecureStorage storage,
    required AppConfig config,
    FlutterAppAuth? appAuth,
  })  : _storage = storage,
        _config = config,
        _appAuth = appAuth ?? const FlutterAppAuth();

  Future<bool> login() async {
    final result = await _appAuth.authorizeAndExchangeCode(
      AuthorizationTokenRequest(
        _config.oidcClientId,
        _config.oidcRedirectUri,
        discoveryUrl: _config.oidcDiscoveryUrl,
        scopes: ['openid', 'profile', 'email'],
      ),
    );

    await _storage.setTokens(
      accessToken: result.accessToken!,
      refreshToken: result.refreshToken!,
      idToken: result.idToken,
    );
    return true;
  }

  Future<bool> refreshToken() async {
    final refreshToken = await _storage.getRefreshToken();
    if (refreshToken == null) return false;

    try {
      final result = await _appAuth.token(
        TokenRequest(
          _config.oidcClientId,
          _config.oidcRedirectUri,
          discoveryUrl: _config.oidcDiscoveryUrl,
          refreshToken: refreshToken,
        ),
      );

      await _storage.setTokens(
        accessToken: result.accessToken!,
        refreshToken: result.refreshToken!,
        idToken: result.idToken,
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> logout() async {
    final idToken = await _storage.getIdToken();
    if (idToken != null) {
      try {
        await _appAuth.endSession(
          EndSessionRequest(
            idTokenHint: idToken,
            postLogoutRedirectUrl: _config.oidcRedirectUri,
            discoveryUrl: _config.oidcDiscoveryUrl,
          ),
        );
      } catch (_) {
        // Ignore errors from OIDC end-session
      }
    }
    await _storage.clearTokens();
  }

  Future<bool> isAuthenticated() => _storage.hasTokens();

  Future<Map<String, dynamic>?> getTokenClaims() async {
    final token = await _storage.getAccessToken();
    if (token == null) return null;
    return _decodeJwtPayload(token);
  }

  Map<String, dynamic>? _decodeJwtPayload(String token) {
    final parts = token.split('.');
    if (parts.length != 3) return null;
    final payload = parts[1];
    final normalized = base64Url.normalize(payload);
    final decoded = utf8.decode(base64Url.decode(normalized));
    return jsonDecode(decoded) as Map<String, dynamic>;
  }
}
