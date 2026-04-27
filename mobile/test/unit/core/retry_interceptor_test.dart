import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:projx_mobile/core/network/retry_interceptor.dart';

class MockHandler extends Mock implements ErrorInterceptorHandler {}

void main() {
  setUpAll(() {
    registerFallbackValue(
        DioException(requestOptions: RequestOptions(path: '')));
  });

  test('passes through 4xx errors (does not retry)', () {
    final interceptor = RetryInterceptor();
    final handler = MockHandler();
    final err = DioException(
      requestOptions: RequestOptions(path: '/x'),
      response: Response(
        requestOptions: RequestOptions(path: '/x'),
        statusCode: 404,
      ),
    );
    when(() => handler.next(any())).thenReturn(null);

    interceptor.onError(err, handler);
    verify(() => handler.next(err)).called(1);
  });

  test('passes through other 5xx (e.g. 500) without retry', () {
    final interceptor = RetryInterceptor();
    final handler = MockHandler();
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
  });

  test('gives up after maxRetries on retryable errors', () async {
    final interceptor = RetryInterceptor(
      maxRetries: 2,
      retryDelay: const Duration(milliseconds: 1),
    );
    final handler = MockHandler();
    final opts = RequestOptions(path: 'http://127.0.0.1:1/x');
    opts.extra['retryCount'] = 2;
    final err = DioException(
      requestOptions: opts,
      type: DioExceptionType.connectionError,
    );
    when(() => handler.next(any())).thenReturn(null);

    interceptor.onError(err, handler);
    verify(() => handler.next(err)).called(1);
  });

  test('attempts retry on connection timeout (exhausts and surfaces error)',
      () async {
    final interceptor = RetryInterceptor(
      maxRetries: 1,
      retryDelay: const Duration(milliseconds: 1),
    );
    final handler = MockHandler();
    final opts = RequestOptions(
      path: '/x',
      baseUrl: 'http://127.0.0.1:1',
      connectTimeout: const Duration(milliseconds: 10),
      receiveTimeout: const Duration(milliseconds: 10),
    );
    final err = DioException(
      requestOptions: opts,
      type: DioExceptionType.connectionTimeout,
    );
    when(() => handler.next(any())).thenReturn(null);

    interceptor.onError(err, handler);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(opts.extra['retryCount'], 1);
  });

  test('retries on 503 with retryCount incrementing', () async {
    final interceptor = RetryInterceptor(
      maxRetries: 1,
      retryDelay: const Duration(milliseconds: 1),
    );
    final handler = MockHandler();
    final opts = RequestOptions(
      path: '/x',
      baseUrl: 'http://127.0.0.1:1',
      connectTimeout: const Duration(milliseconds: 10),
      receiveTimeout: const Duration(milliseconds: 10),
    );
    final err = DioException(
      requestOptions: opts,
      response: Response(requestOptions: opts, statusCode: 503),
    );
    when(() => handler.next(any())).thenReturn(null);

    interceptor.onError(err, handler);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(opts.extra['retryCount'], 1);
  });
}
