import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/core/routing/routes.dart';

void main() {
  test('static route constants are non-empty paths', () {
    expect(Routes.login, '/login');
    expect(Routes.splash, '/splash');
    expect(Routes.dashboard, '/');
    expect(Routes.settings, '/settings');
  });

  test('entityList builds /entities/<slug>', () {
    expect(Routes.entityList('widgets'), '/entities/widgets');
  });

  test('entityDetail builds /entities/<slug>/<id>', () {
    expect(Routes.entityDetail('widgets', '42'), '/entities/widgets/42');
  });

  test('entityCreate builds /entities/<slug>/new', () {
    expect(Routes.entityCreate('widgets'), '/entities/widgets/new');
  });

  test('entityEdit builds /entities/<slug>/<id>/edit', () {
    expect(Routes.entityEdit('widgets', '42'), '/entities/widgets/42/edit');
  });
}
