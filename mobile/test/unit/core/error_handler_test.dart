import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/core/errors/app_exception.dart';
import 'package:projx_mobile/core/errors/error_handler.dart';

void main() {
  group('ErrorHandler.userMessage', () {
    test('returns message from AppException', () {
      const exception = NotFoundException(message: 'User not found');
      expect(ErrorHandler.userMessage(exception), 'User not found');
    });

    test('returns message for 401 DioException', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/test'),
        response: Response(
          requestOptions: RequestOptions(path: '/test'),
          statusCode: 401,
        ),
      );
      expect(
        ErrorHandler.userMessage(error),
        'Session expired. Please log in again.',
      );
    });

    test('returns message for 403 DioException', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/test'),
        response: Response(
          requestOptions: RequestOptions(path: '/test'),
          statusCode: 403,
        ),
      );
      expect(
        ErrorHandler.userMessage(error),
        "You don't have permission to do this.",
      );
    });

    test('returns detail from 404 response', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/test'),
        response: Response(
          requestOptions: RequestOptions(path: '/test'),
          statusCode: 404,
          data: {'detail': 'Product not found'},
        ),
      );
      expect(ErrorHandler.userMessage(error), 'Product not found');
    });

    test('returns generic message for 500', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/test'),
        response: Response(
          requestOptions: RequestOptions(path: '/test'),
          statusCode: 500,
        ),
      );
      expect(
        ErrorHandler.userMessage(error),
        'Something went wrong. Please try again.',
      );
    });

    test('returns network message for connection error', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/test'),
        type: DioExceptionType.connectionError,
      );
      expect(ErrorHandler.userMessage(error), 'No internet connection');
    });

    test('returns timeout message for connection timeout', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/test'),
        type: DioExceptionType.connectionTimeout,
      );
      expect(ErrorHandler.userMessage(error), 'Request timed out');
    });

    test('returns generic message for unknown error', () {
      expect(
        ErrorHandler.userMessage(Exception('oops')),
        'Something went wrong',
      );
    });
  });

  group('ErrorHandler.fromDioException', () {
    test('returns UnauthorizedException for 401', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/test'),
        response: Response(
          requestOptions: RequestOptions(path: '/test'),
          statusCode: 401,
        ),
      );
      expect(
        ErrorHandler.fromDioException(error),
        isA<UnauthorizedException>(),
      );
    });

    test('returns ValidationException with field errors for 422', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/test'),
        response: Response(
          requestOptions: RequestOptions(path: '/test'),
          statusCode: 422,
          data: {
            'detail': 'Validation failed',
            'field_errors': {'email': 'Invalid format'},
          },
        ),
      );
      final exception = ErrorHandler.fromDioException(error);
      expect(exception, isA<ValidationException>());
      expect(
        (exception as ValidationException).fieldErrors?['email'],
        'Invalid format',
      );
    });

    test('returns NetworkException for connection error', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/test'),
        type: DioExceptionType.connectionError,
      );
      expect(ErrorHandler.fromDioException(error), isA<NetworkException>());
    });

    test('returns RateLimitException for 429', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/test'),
        response: Response(
          requestOptions: RequestOptions(path: '/test'),
          statusCode: 429,
        ),
      );
      expect(ErrorHandler.fromDioException(error), isA<RateLimitException>());
    });
  });
}
