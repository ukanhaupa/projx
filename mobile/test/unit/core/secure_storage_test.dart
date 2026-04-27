import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:projx_mobile/core/auth/secure_storage.dart';
import 'package:projx_mobile/core/config/constants.dart';

class MockFlutterSecureStorage extends Mock implements FlutterSecureStorage {}

void main() {
  late MockFlutterSecureStorage backing;
  late SecureStorage storage;

  setUpAll(() {
    registerFallbackValue('');
  });

  setUp(() {
    backing = MockFlutterSecureStorage();
    storage = SecureStorage(storage: backing);
    when(() =>
            backing.write(key: any(named: 'key'), value: any(named: 'value')))
        .thenAnswer((_) async {});
    when(() => backing.delete(key: any(named: 'key'))).thenAnswer((_) async {});
  });

  test('getAccessToken / setAccessToken round-trip via the backing store',
      () async {
    when(() => backing.read(key: StorageKeys.accessToken))
        .thenAnswer((_) async => 'access-1');

    expect(await storage.getAccessToken(), 'access-1');

    await storage.setAccessToken('access-2');
    verify(() => backing.write(key: StorageKeys.accessToken, value: 'access-2'))
        .called(1);
  });

  test('getRefreshToken / setRefreshToken round-trip', () async {
    when(() => backing.read(key: StorageKeys.refreshToken))
        .thenAnswer((_) async => 'refresh-1');
    expect(await storage.getRefreshToken(), 'refresh-1');

    await storage.setRefreshToken('refresh-2');
    verify(() =>
            backing.write(key: StorageKeys.refreshToken, value: 'refresh-2'))
        .called(1);
  });

  test('getIdToken / setIdToken round-trip', () async {
    when(() => backing.read(key: StorageKeys.idToken))
        .thenAnswer((_) async => 'id-1');
    expect(await storage.getIdToken(), 'id-1');

    await storage.setIdToken('id-2');
    verify(() => backing.write(key: StorageKeys.idToken, value: 'id-2'))
        .called(1);
  });

  test('setTokens writes access + refresh + id concurrently', () async {
    await storage.setTokens(
      accessToken: 'a',
      refreshToken: 'r',
      idToken: 'i',
    );

    verify(() => backing.write(key: StorageKeys.accessToken, value: 'a'))
        .called(1);
    verify(() => backing.write(key: StorageKeys.refreshToken, value: 'r'))
        .called(1);
    verify(() => backing.write(key: StorageKeys.idToken, value: 'i')).called(1);
  });

  test('setTokens skips id token when not provided', () async {
    await storage.setTokens(accessToken: 'a', refreshToken: 'r');

    verify(() => backing.write(key: StorageKeys.accessToken, value: 'a'))
        .called(1);
    verify(() => backing.write(key: StorageKeys.refreshToken, value: 'r'))
        .called(1);
    verifyNever(() =>
        backing.write(key: StorageKeys.idToken, value: any(named: 'value')));
  });

  test('clearTokens deletes all three keys', () async {
    await storage.clearTokens();

    verify(() => backing.delete(key: StorageKeys.accessToken)).called(1);
    verify(() => backing.delete(key: StorageKeys.refreshToken)).called(1);
    verify(() => backing.delete(key: StorageKeys.idToken)).called(1);
  });

  test('hasTokens returns true when access token is non-empty', () async {
    when(() => backing.read(key: StorageKeys.accessToken))
        .thenAnswer((_) async => 'token');
    expect(await storage.hasTokens(), isTrue);
  });

  test('hasTokens returns false when access token is null', () async {
    when(() => backing.read(key: StorageKeys.accessToken))
        .thenAnswer((_) async => null);
    expect(await storage.hasTokens(), isFalse);
  });

  test('hasTokens returns false when access token is empty string', () async {
    when(() => backing.read(key: StorageKeys.accessToken))
        .thenAnswer((_) async => '');
    expect(await storage.hasTokens(), isFalse);
  });
}
