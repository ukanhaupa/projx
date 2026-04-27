class AppConfig {
  final String apiBaseUrl;
  final String oidcRealmUrl;
  final String oidcClientId;
  final String oidcRedirectUri;
  final bool fcmEnabled;

  const AppConfig({
    required this.apiBaseUrl,
    required this.oidcRealmUrl,
    required this.oidcClientId,
    required this.oidcRedirectUri,
    required this.fcmEnabled,
  });

  factory AppConfig.fromEnvironment() {
    return const AppConfig(
      apiBaseUrl: String.fromEnvironment(
        'API_BASE_URL',
        defaultValue: 'http://localhost:8000',
      ),
      oidcRealmUrl: String.fromEnvironment(
        'OIDC_REALM_URL',
        defaultValue: 'http://localhost:8080/realms/my-project',
      ),
      oidcClientId: String.fromEnvironment(
        'OIDC_CLIENT_ID',
        defaultValue: 'mobile-app',
      ),
      oidcRedirectUri: String.fromEnvironment(
        'OIDC_REDIRECT_URI',
        defaultValue: 'com.example.app://callback',
      ),
      fcmEnabled: bool.fromEnvironment('FCM_ENABLED', defaultValue: false),
    );
  }

  String get oidcAuthEndpoint => '$oidcRealmUrl/protocol/openid-connect/auth';
  String get oidcTokenEndpoint => '$oidcRealmUrl/protocol/openid-connect/token';
  String get oidcLogoutEndpoint =>
      '$oidcRealmUrl/protocol/openid-connect/logout';
  String get oidcDiscoveryUrl =>
      '$oidcRealmUrl/.well-known/openid-configuration';
}
