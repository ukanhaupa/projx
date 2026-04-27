import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/core/config/app_config.dart';

void main() {
  test('AppConfig.fromEnvironment uses default values without --dart-define',
      () {
    final cfg = AppConfig.fromEnvironment();
    expect(cfg.apiBaseUrl, isNotEmpty);
    expect(cfg.oidcRealmUrl, isNotEmpty);
    expect(cfg.oidcClientId, isNotEmpty);
    expect(cfg.oidcRedirectUri, isNotEmpty);
    expect(cfg.fcmEnabled, isFalse);
  });

  test('OIDC endpoint helpers derive from realm URL', () {
    const cfg = AppConfig(
      apiBaseUrl: 'https://api.example.com',
      oidcRealmUrl: 'https://auth.example.com/realms/my-project',
      oidcClientId: 'mobile',
      oidcRedirectUri: 'com.example.app://callback',
      fcmEnabled: true,
    );

    expect(cfg.oidcAuthEndpoint,
        'https://auth.example.com/realms/my-project/protocol/openid-connect/auth');
    expect(cfg.oidcTokenEndpoint,
        'https://auth.example.com/realms/my-project/protocol/openid-connect/token');
    expect(cfg.oidcLogoutEndpoint,
        'https://auth.example.com/realms/my-project/protocol/openid-connect/logout');
    expect(cfg.oidcDiscoveryUrl,
        'https://auth.example.com/realms/my-project/.well-known/openid-configuration');
  });
}
