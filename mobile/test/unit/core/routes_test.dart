import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/core/routing/routes.dart';

void main() {
  test('static route constants are non-empty paths', () {
    expect(Routes.login, '/login');
    expect(Routes.splash, '/splash');
    expect(Routes.dashboard, '/');
    expect(Routes.settings, '/settings');
  });
}
