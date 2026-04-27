import 'package:dio/dio.dart';
import 'package:projx_mobile/core/errors/app_exception.dart';

class ErrorHandler {
  static String userMessage(Object error) {
    if (error is AppException) return error.message;
    if (error is DioException) return _dioMessage(error);
    return 'Something went wrong';
  }

  static String _dioMessage(DioException error) {
    final statusCode = error.response?.statusCode;
    final data = error.response?.data;
    final detail = data is Map ? data['detail'] as String? : null;

    return switch (statusCode) {
      400 => detail ?? 'Invalid request',
      401 => 'Session expired. Please log in again.',
      403 => 'You don\'t have permission to do this.',
      404 => detail ?? 'Item not found',
      409 => detail ?? 'This item already exists',
      422 => detail ?? 'Validation failed',
      429 => 'Too many requests. Please wait a moment.',
      _ when statusCode != null && statusCode >= 500 =>
        'Something went wrong. Please try again.',
      _ => error.type == DioExceptionType.connectionError
          ? 'No internet connection'
          : error.type == DioExceptionType.connectionTimeout ||
                  error.type == DioExceptionType.receiveTimeout
              ? 'Request timed out'
              : 'Something went wrong',
    };
  }

  static AppException fromDioException(DioException error) {
    final statusCode = error.response?.statusCode;
    final data = error.response?.data;
    final detail = data is Map ? data['detail'] as String? : null;
    final requestId = (data is Map ? data['request_id'] as String? : null) ??
        error.response?.headers.value('x-request-id');
    final fieldErrors = data is Map && data['field_errors'] is Map
        ? (data['field_errors'] as Map).map(
            (k, v) => MapEntry(k.toString(), v.toString()),
          )
        : null;

    return switch (statusCode) {
      400 => ValidationException(
          message: detail ?? 'Invalid request',
          fieldErrors: fieldErrors,
          requestId: requestId,
        ),
      401 => UnauthorizedException(requestId: requestId),
      403 => ForbiddenException(
          message: detail ?? 'You don\'t have permission to do this.',
          requestId: requestId,
        ),
      404 => NotFoundException(
          message: detail ?? 'Item not found',
          requestId: requestId,
        ),
      409 => ConflictException(
          message: detail ?? 'This item already exists',
          requestId: requestId,
        ),
      422 => ValidationException(
          message: detail ?? 'Validation failed',
          fieldErrors: fieldErrors,
          requestId: requestId,
        ),
      429 => RateLimitException(
          requestId: requestId,
          retryAfter: _parseRetryAfter(error.response?.headers),
        ),
      _ when statusCode != null && statusCode >= 500 =>
        ServerException(statusCode: statusCode, requestId: requestId),
      _ => error.type == DioExceptionType.connectionError
          ? const NetworkException()
          : error.type == DioExceptionType.connectionTimeout ||
                  error.type == DioExceptionType.receiveTimeout
              ? const TimeoutException()
              : ServerException(
                  message: detail ?? 'Something went wrong',
                  requestId: requestId,
                ),
    };
  }

  static Duration? _parseRetryAfter(Headers? headers) {
    final retryAfter = headers?.value('retry-after');
    if (retryAfter == null) return null;
    final seconds = int.tryParse(retryAfter);
    if (seconds != null) return Duration(seconds: seconds);
    return null;
  }
}
