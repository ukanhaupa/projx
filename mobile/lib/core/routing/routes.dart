class Routes {
  static const String login = '/login';
  static const String splash = '/splash';
  static const String dashboard = '/';
  static const String settings = '/settings';
  static String entityList(String slug) => '/entities/$slug';
  static String entityDetail(String slug, String id) => '/entities/$slug/$id';
  static String entityCreate(String slug) => '/entities/$slug/new';
  static String entityEdit(String slug, String id) =>
      '/entities/$slug/$id/edit';
}
