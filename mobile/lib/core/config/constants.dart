class ApiPaths {
  static const String meta = '/api/v1/_meta';
  static const String health = '/api/health';
  static String entityBase(String slug) => '/api/v1/$slug/';
  static String entityById(String slug, String id) => '/api/v1/$slug/$id';
  static String entityBulk(String slug) => '/api/v1/$slug/bulk';
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
