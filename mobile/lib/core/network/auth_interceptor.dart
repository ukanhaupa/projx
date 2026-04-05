import 'package:dio/dio.dart';
import 'package:projx_mobile/core/auth/auth_service.dart';
import 'package:projx_mobile/core/auth/secure_storage.dart';

class AuthInterceptor extends Interceptor {
  final SecureStorage _storage;
  final AuthService _authService;
  bool _isRefreshing = false;

  AuthInterceptor(this._storage, this._authService);

  @override
  void onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await _storage.getAccessToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode != 401 || _isRefreshing) {
      return handler.next(err);
    }

    _isRefreshing = true;
    try {
      final refreshed = await _authService.refreshToken();
      if (refreshed) {
        final retryResponse = await _retryRequest(err.requestOptions);
        _isRefreshing = false;
        return handler.resolve(retryResponse);
      }
      await _authService.logout();
    } catch (_) {
      await _authService.logout();
    }
    _isRefreshing = false;
    handler.next(err);
  }

  Future<Response<dynamic>> _retryRequest(RequestOptions options) async {
    final token = await _storage.getAccessToken();
    options.headers['Authorization'] = 'Bearer $token';
    final dio = Dio(
      BaseOptions(
        baseUrl: options.baseUrl,
        connectTimeout: options.connectTimeout,
        receiveTimeout: options.receiveTimeout,
      ),
    );
    return dio.request(
      options.path,
      data: options.data,
      queryParameters: options.queryParameters,
      options: Options(method: options.method, headers: options.headers),
    );
  }
}
