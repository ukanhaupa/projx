import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isar/isar.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/entities/base/entity_providers.dart';
import 'package:projx_mobile/features/dashboard/dashboard_screen.dart';

class MockIsar extends Mock implements Isar {}

const _testConfigs = [
  EntityConfig(
    slug: 'test-items',
    name: 'Test Item',
    namePlural: 'Test Items',
    fields: [
      FieldConfig(
        key: 'id',
        label: 'ID',
        type: 'int',
        fieldType: FieldType.number,
        isAuto: true,
        isPrimaryKey: true,
      ),
      FieldConfig(
        key: 'name',
        label: 'Name',
        type: 'str',
        fieldType: FieldType.text,
      ),
      FieldConfig(
        key: 'value',
        label: 'Value',
        type: 'float',
        fieldType: FieldType.number,
      ),
    ],
  ),
  EntityConfig(
    slug: 'test-records',
    name: 'Test Record',
    namePlural: 'Test Records',
    fields: [
      FieldConfig(
        key: 'id',
        label: 'ID',
        type: 'int',
        fieldType: FieldType.number,
        isAuto: true,
        isPrimaryKey: true,
      ),
      FieldConfig(
        key: 'total',
        label: 'Total',
        type: 'float',
        fieldType: FieldType.number,
      ),
    ],
  ),
];

void main() {
  late MockIsar mockIsar;
  late SharedPreferences prefs;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    mockIsar = MockIsar();
  });

  Widget buildSubject({required List<Override> overrides}) {
    return ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        isarProvider.overrideWithValue(mockIsar),
        ...overrides,
      ],
      child: const MaterialApp(home: DashboardScreen()),
    );
  }

  testWidgets('shows Dashboard title', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityConfigsProvider.overrideWith((ref) async => _testConfigs),
        ],
      ),
    );

    expect(find.text('Dashboard'), findsOneWidget);
  });

  testWidgets('shows entity cards when data loaded', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityConfigsProvider.overrideWith((ref) async => _testConfigs),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Test Items'), findsOneWidget);
    expect(find.text('Test Records'), findsOneWidget);
    expect(find.text('Full CRUD'), findsNWidgets(2));
  });

  testWidgets('shows shimmer loading state', (tester) async {
    final completer = Completer<List<EntityConfig>>();
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityConfigsProvider.overrideWith((ref) => completer.future),
        ],
      ),
    );

    // Should show 6 shimmer cards in a GridView
    expect(find.byType(GridView), findsOneWidget);
  });

  testWidgets('shows empty state when no entities', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityConfigsProvider.overrideWith((ref) async => <EntityConfig>[]),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No entities configured'), findsOneWidget);
  });

  testWidgets('shows error state with retry button', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityConfigsProvider.overrideWith((ref) async {
            throw Exception('Network error');
          }),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Something went wrong'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });
}
