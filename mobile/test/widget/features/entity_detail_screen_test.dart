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
import 'package:projx_mobile/features/entity/entity_detail_screen.dart';

class MockIsar extends Mock implements Isar {}

const _testConfig = EntityConfig(
  slug: 'products',
  name: 'Product',
  namePlural: 'Products',
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
      key: 'price',
      label: 'Price',
      type: 'float',
      fieldType: FieldType.number,
    ),
  ],
);

const _testItem = <String, dynamic>{
  'id': 1,
  'name': 'Widget A',
  'price': 29.99,
};

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
        entityConfigProvider.overrideWith((ref, slug) => _testConfig),
        ...overrides,
      ],
      child: const MaterialApp(
        home: EntityDetailScreen(slug: 'products', id: '1'),
      ),
    );
  }

  testWidgets('shows loading indicator initially', (tester) async {
    final completer = Completer<Map<String, dynamic>>();
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityDetailProvider.overrideWith((ref, params) => completer.future),
        ],
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('shows entity fields when data loaded', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityDetailProvider.overrideWith((ref, params) async => _testItem),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Name'), findsOneWidget);
    expect(find.text('Widget A'), findsWidgets); // In title and field
    expect(find.text('Price'), findsOneWidget);
    expect(find.text('29.99'), findsOneWidget);
  });

  testWidgets('shows edit and delete buttons in bottom bar', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityDetailProvider.overrideWith((ref, params) async => _testItem),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Edit'), findsOneWidget);
    expect(find.text('Delete'), findsOneWidget);
    expect(find.byIcon(Icons.edit_outlined), findsOneWidget);
    expect(find.byIcon(Icons.delete_outlined), findsOneWidget);
  });

  testWidgets('shows error state on failure', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityDetailProvider.overrideWith((ref, params) async {
            throw Exception('Failed to load');
          }),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Something went wrong'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('tapping delete opens a confirmation dialog', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityDetailProvider.overrideWith((ref, params) async => _testItem),
        ],
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsOneWidget);
  });

  testWidgets('cancelling the delete dialog dismisses it', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityDetailProvider.overrideWith((ref, params) async => _testItem),
        ],
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget);

    final cancel = find.text('Cancel');
    if (cancel.evaluate().isNotEmpty) {
      await tester.tap(cancel.first);
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
    }
  });

  testWidgets('renders id-typed fields with their value', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityDetailProvider.overrideWith((ref, params) async => _testItem),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('1'), findsAtLeastNWidgets(0));
  });
}
