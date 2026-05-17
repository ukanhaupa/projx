class ApiPaths {
  static const String health = '/api/health';
}

class Pagination {
  static const int defaultPageSize = 20;
  static const int maxPageSize = 100;
}

class Debounce {
  static const Duration search = Duration(milliseconds: 400);
}

class StorageKeys {
  static const String accessToken = 'access_token';
  static const String refreshToken = 'refresh_token';
  static const String idToken = 'id_token';
  static const String themeMode = 'theme_mode';
  static const String biometricEnabled = 'biometric_enabled';
}
