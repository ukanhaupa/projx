import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/entities/entity_overrides.dart';

void main() {
  test('default icon for unknown slug is the table icon', () {
    expect(EntityOverrides.getIcon('whatever'), Icons.table_chart_outlined);
  });

  test('audit-logs has a history-themed default icon', () {
    expect(EntityOverrides.getIcon('audit-logs'), Icons.history_outlined);
  });

  test('register overrides the default icon', () {
    EntityOverrides.register(
      'custom',
      const EntityOverride(icon: Icons.star),
    );
    expect(EntityOverrides.getIcon('custom'), Icons.star);
    expect(EntityOverrides.get('custom')?.icon, Icons.star);
  });

  test('get returns null for an unregistered slug', () {
    expect(EntityOverrides.get('not-here'), isNull);
  });
}
