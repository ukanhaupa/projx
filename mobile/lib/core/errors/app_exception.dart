sealed class AppException implements Exception {
  final String message;
  final int? statusCode;
  final String? requestId;
  final Map<String, String>? fieldErrors;

  const AppException({
    required this.message,
    this.statusCode,
    this.requestId,
    this.fieldErrors,
  });
}

class NetworkException extends AppException {
  const NetworkException({super.message = 'No internet connection'});
}

class TimeoutException extends AppException {
  const TimeoutException({super.message = 'Request timed out'});
}

class UnauthorizedException extends AppException {
  const UnauthorizedException({
    super.message = 'Session expired. Please log in again.',
    super.statusCode = 401,
    super.requestId,
  });
}

class ForbiddenException extends AppException {
  const ForbiddenException({
    super.message = 'You don\'t have permission to do this.',
    super.statusCode = 403,
    super.requestId,
  });
}

class NotFoundException extends AppException {
  const NotFoundException({
    super.message = 'Item not found',
    super.statusCode = 404,
    super.requestId,
  });
}

class ConflictException extends AppException {
  const ConflictException({
    super.message = 'This item already exists',
    super.statusCode = 409,
    super.requestId,
  });
}

class ValidationException extends AppException {
  const ValidationException({
    super.message = 'Validation failed',
    super.statusCode = 422,
    super.fieldErrors,
    super.requestId,
  });
}

class RateLimitException extends AppException {
  final Duration? retryAfter;

  const RateLimitException({
    super.message = 'Too many requests. Please wait a moment.',
    super.statusCode = 429,
    super.requestId,
    this.retryAfter,
  });
}

class ServerException extends AppException {
  const ServerException({
    super.message = 'Something went wrong. Please try again.',
    super.statusCode,
    super.requestId,
  });
}
