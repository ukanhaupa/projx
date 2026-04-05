class AppConfig {
  final String apiBaseUrl;
  final bool authEnabled;
  final String keycloakRealmUrl;
  final String keycloakClientId;
  final String keycloakRedirectUri;
  final bool fcmEnabled;

  const AppConfig({
    required this.apiBaseUrl,
    required this.authEnabled,
    required this.keycloakRealmUrl,
    required this.keycloakClientId,
    required this.keycloakRedirectUri,
    required this.fcmEnabled,
  });

  factory AppConfig.fromEnvironment() {
    return const AppConfig(
      apiBaseUrl: String.fromEnvironment(
        'API_BASE_URL',
        defaultValue: 'http://localhost:8000',
      ),
      authEnabled: bool.fromEnvironment('AUTH_ENABLED', defaultValue: true),
      keycloakRealmUrl: String.fromEnvironment(
        'KEYCLOAK_REALM_URL',
        defaultValue: 'http://localhost:8080/realms/my-project',
      ),
      keycloakClientId: String.fromEnvironment(
        'KEYCLOAK_CLIENT_ID',
        defaultValue: 'mobile-app',
      ),
      keycloakRedirectUri: String.fromEnvironment(
        'KEYCLOAK_REDIRECT_URI',
        defaultValue: 'com.example.app://callback',
      ),
      fcmEnabled: bool.fromEnvironment('FCM_ENABLED', defaultValue: false),
    );
  }

  String get keycloakAuthEndpoint =>
      '$keycloakRealmUrl/protocol/openid-connect/auth';
  String get keycloakTokenEndpoint =>
      '$keycloakRealmUrl/protocol/openid-connect/token';
  String get keycloakLogoutEndpoint =>
      '$keycloakRealmUrl/protocol/openid-connect/logout';
  String get keycloakDiscoveryUrl =>
      '$keycloakRealmUrl/.well-known/openid-configuration';
}
