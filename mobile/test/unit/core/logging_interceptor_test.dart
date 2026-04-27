import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:projx_mobile/core/network/logging_interceptor.dart';

class MockRequestHandler extends Mock implements RequestInterceptorHandler {}

class MockResponseHandler extends Mock implements ResponseInterceptorHandler {}

class MockErrorHandler extends Mock implements ErrorInterceptorHandler {}

void main() {
  setUpAll(() {
    registerFallbackValue(RequestOptions(path: ''));
    registerFallbackValue(Response(requestOptions: RequestOptions(path: '')));
    registerFallbackValue(
        DioException(requestOptions: RequestOptions(path: '')));
  });

  late LoggingInterceptor interceptor;

  setUp(() {
    interceptor = LoggingInterceptor();
  });

  test('onRequest calls handler.next with options', () {
    final handler = MockRequestHandler();
    final opts = RequestOptions(path: '/x', method: 'GET');
    when(() => handler.next(any())).thenReturn(null);

    interceptor.onRequest(opts, handler);
    verify(() => handler.next(opts)).called(1);
  });

  test('onResponse calls handler.next with response', () {
    final handler = MockResponseHandler();
    final res =
        Response(requestOptions: RequestOptions(path: '/x'), statusCode: 200);
    when(() => handler.next(any())).thenReturn(null);

    interceptor.onResponse(res, handler);
    verify(() => handler.next(res)).called(1);
  });

  test('onError calls handler.next with error', () {
    final handler = MockErrorHandler();
    final err = DioException(
      requestOptions: RequestOptions(path: '/x', method: 'POST'),
      message: 'boom',
      response:
          Response(requestOptions: RequestOptions(path: '/x'), statusCode: 500),
    );
    when(() => handler.next(any())).thenReturn(null);

    interceptor.onError(err, handler);
    verify(() => handler.next(err)).called(1);
  });

  test('onError handles error without response (network failure)', () {
    final handler = MockErrorHandler();
    final err = DioException(
      requestOptions: RequestOptions(path: '/x', method: 'GET'),
      type: DioExceptionType.connectionError,
      message: 'no net',
    );
    when(() => handler.next(any())).thenReturn(null);

    interceptor.onError(err, handler);
    verify(() => handler.next(err)).called(1);
  });
}
