import 'dart:convert';

import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:projx_mobile/core/auth/auth_service.dart';
import 'package:projx_mobile/core/auth/secure_storage.dart';
import 'package:projx_mobile/core/config/app_config.dart';

class MockAppAuth extends Mock implements FlutterAppAuth {}

class MockSecureStorage extends Mock implements SecureStorage {}

const _config = AppConfig(
  apiBaseUrl: 'https://api.example.com',
  oidcRealmUrl: 'https://auth.example.com/realms/p',
  oidcClientId: 'mobile',
  oidcRedirectUri: 'app://callback',
  fcmEnabled: false,
);

AuthorizationTokenResponse _tokenResponse({
  String? access = 'a-token',
  String? refresh = 'r-token',
  String? id = 'i-token',
}) {
  return AuthorizationTokenResponse(
    access,
    refresh,
    null,
    id,
    null,
    null,
    {},
    {},
  );
}

TokenResponse _tokenOnly({
  String? access = 'a2',
  String? refresh = 'r2',
  String? id = 'i2',
}) {
  return TokenResponse(access, refresh, null, id, null, null, {});
}

void main() {
  setUpAll(() {
    registerFallbackValue(
        AuthorizationTokenRequest('c', 'u', issuer: 'https://x'));
    registerFallbackValue(TokenRequest('c', 'u', issuer: 'https://x'));
    registerFallbackValue(EndSessionRequest(issuer: 'https://x'));
  });

  late MockAppAuth appAuth;
  late MockSecureStorage storage;
  late AuthService service;

  setUp(() {
    appAuth = MockAppAuth();
    storage = MockSecureStorage();
    service = AuthService(storage: storage, config: _config, appAuth: appAuth);

    when(() => storage.setTokens(
          accessToken: any(named: 'accessToken'),
          refreshToken: any(named: 'refreshToken'),
          idToken: any(named: 'idToken'),
        )).thenAnswer((_) async {});
    when(() => storage.clearTokens()).thenAnswer((_) async {});
  });

  test('login authorizes, exchanges code, stores tokens, returns true',
      () async {
    when(() => appAuth.authorizeAndExchangeCode(any()))
        .thenAnswer((_) async => _tokenResponse());

    final ok = await service.login();

    expect(ok, isTrue);
    verify(() => storage.setTokens(
          accessToken: 'a-token',
          refreshToken: 'r-token',
          idToken: 'i-token',
        )).called(1);
  });

  test('refreshToken returns false when no refresh token is stored', () async {
    when(() => storage.getRefreshToken()).thenAnswer((_) async => null);

    expect(await service.refreshToken(), isFalse);
    verifyNever(() => appAuth.token(any()));
  });

  test('refreshToken returns true and stores new tokens on success', () async {
    when(() => storage.getRefreshToken()).thenAnswer((_) async => 'old-r');
    when(() => appAuth.token(any())).thenAnswer((_) async => _tokenOnly());

    expect(await service.refreshToken(), isTrue);
    verify(() => storage.setTokens(
          accessToken: 'a2',
          refreshToken: 'r2',
          idToken: 'i2',
        )).called(1);
  });

  test('refreshToken returns false when token endpoint throws', () async {
    when(() => storage.getRefreshToken()).thenAnswer((_) async => 'old-r');
    when(() => appAuth.token(any())).thenThrow(Exception('boom'));

    expect(await service.refreshToken(), isFalse);
    verifyNever(() => storage.setTokens(
          accessToken: any(named: 'accessToken'),
          refreshToken: any(named: 'refreshToken'),
          idToken: any(named: 'idToken'),
        ));
  });

  test('logout calls endSession when id token exists, then clears tokens',
      () async {
    when(() => storage.getIdToken()).thenAnswer((_) async => 'id-1');
    when(() => appAuth.endSession(any()))
        .thenAnswer((_) async => EndSessionResponse('s'));

    await service.logout();

    verify(() => appAuth.endSession(any())).called(1);
    verify(() => storage.clearTokens()).called(1);
  });

  test('logout still clears tokens when endSession throws', () async {
    when(() => storage.getIdToken()).thenAnswer((_) async => 'id-1');
    when(() => appAuth.endSession(any())).thenThrow(Exception('idp down'));

    await service.logout();
    verify(() => storage.clearTokens()).called(1);
  });

  test('logout skips endSession when no id token is stored', () async {
    when(() => storage.getIdToken()).thenAnswer((_) async => null);
    await service.logout();
    verifyNever(() => appAuth.endSession(any()));
    verify(() => storage.clearTokens()).called(1);
  });

  test('isAuthenticated reflects storage.hasTokens', () async {
    when(() => storage.hasTokens()).thenAnswer((_) async => true);
    expect(await service.isAuthenticated(), isTrue);

    when(() => storage.hasTokens()).thenAnswer((_) async => false);
    expect(await service.isAuthenticated(), isFalse);
  });

  test('getTokenClaims returns null when no access token', () async {
    when(() => storage.getAccessToken()).thenAnswer((_) async => null);
    expect(await service.getTokenClaims(), isNull);
  });

  test('getTokenClaims returns null for malformed token', () async {
    when(() => storage.getAccessToken())
        .thenAnswer((_) async => 'not.a.jwt.toomany');
    expect(await service.getTokenClaims(), isNull);
  });

  test('getTokenClaims decodes base64url JWT payload', () async {
    final payload =
        base64Url.encode(utf8.encode(jsonEncode({'sub': 'user-1'})));
    final fakeJwt = 'header.${payload.replaceAll("=", "")}.sig';
    when(() => storage.getAccessToken()).thenAnswer((_) async => fakeJwt);

    final claims = await service.getTokenClaims();
    expect(claims, {'sub': 'user-1'});
  });
}
