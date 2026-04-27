import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:projx_mobile/core/auth/auth_service.dart';
import 'package:projx_mobile/core/auth/secure_storage.dart';
import 'package:projx_mobile/core/network/auth_interceptor.dart';

class MockSecureStorage extends Mock implements SecureStorage {}

class MockAuthService extends Mock implements AuthService {}

class MockRequestHandler extends Mock implements RequestInterceptorHandler {}

class MockErrorHandler extends Mock implements ErrorInterceptorHandler {}

void main() {
  setUpAll(() {
    registerFallbackValue(RequestOptions(path: ''));
    registerFallbackValue(
        DioException(requestOptions: RequestOptions(path: '')));
    registerFallbackValue(Response(requestOptions: RequestOptions(path: '')));
  });

  late MockSecureStorage storage;
  late MockAuthService auth;
  late AuthInterceptor interceptor;

  setUp(() {
    storage = MockSecureStorage();
    auth = MockAuthService();
    interceptor = AuthInterceptor(storage, auth);
  });

  test('onRequest attaches Authorization header when access token is set',
      () async {
    when(() => storage.getAccessToken()).thenAnswer((_) async => 'token-1');
    final handler = MockRequestHandler();
    final opts = RequestOptions(path: '/x');
    when(() => handler.next(any())).thenReturn(null);

    interceptor.onRequest(opts, handler);
    await Future<void>.delayed(Duration.zero);

    expect(opts.headers['Authorization'], 'Bearer token-1');
    verify(() => handler.next(opts)).called(1);
  });

  test('onRequest does not attach header when no token is stored', () async {
    when(() => storage.getAccessToken()).thenAnswer((_) async => null);
    final handler = MockRequestHandler();
    final opts = RequestOptions(path: '/x');
    when(() => handler.next(any())).thenReturn(null);

    interceptor.onRequest(opts, handler);
    await Future<void>.delayed(Duration.zero);

    expect(opts.headers.containsKey('Authorization'), isFalse);
    verify(() => handler.next(opts)).called(1);
  });

  test('onError passes through non-401 errors without refresh', () {
    final handler = MockErrorHandler();
    final err = DioException(
      requestOptions: RequestOptions(path: '/x'),
      response: Response(
        requestOptions: RequestOptions(path: '/x'),
        statusCode: 500,
      ),
    );
    when(() => handler.next(any())).thenReturn(null);

    interceptor.onError(err, handler);
    verify(() => handler.next(err)).called(1);
    verifyNever(() => auth.refreshToken());
  });

  test('onError logs out when refreshToken fails', () async {
    when(() => auth.refreshToken()).thenAnswer((_) async => false);
    when(() => auth.logout()).thenAnswer((_) async {});

    final handler = MockErrorHandler();
    final err = DioException(
      requestOptions: RequestOptions(path: '/x'),
      response: Response(
        requestOptions: RequestOptions(path: '/x'),
        statusCode: 401,
      ),
    );
    when(() => handler.next(any())).thenReturn(null);

    interceptor.onError(err, handler);
    await Future<void>.delayed(const Duration(milliseconds: 30));

    verify(() => auth.refreshToken()).called(1);
    verify(() => auth.logout()).called(1);
  });

  test('onError logs out when refreshToken throws', () async {
    when(() => auth.refreshToken()).thenThrow(Exception('idp down'));
    when(() => auth.logout()).thenAnswer((_) async {});

    final handler = MockErrorHandler();
    final err = DioException(
      requestOptions: RequestOptions(path: '/x'),
      response: Response(
        requestOptions: RequestOptions(path: '/x'),
        statusCode: 401,
      ),
    );
    when(() => handler.next(any())).thenReturn(null);

    interceptor.onError(err, handler);
    await Future<void>.delayed(const Duration(milliseconds: 30));

    verify(() => auth.logout()).called(1);
  });
}
