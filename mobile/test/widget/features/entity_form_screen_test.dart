import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isar/isar.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/entities/base/entity_providers.dart';
import 'package:projx_mobile/features/entity/entity_form_screen.dart';

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
    FieldConfig(
      key: 'active',
      label: 'Active',
      type: 'bool',
      fieldType: FieldType.boolean,
      filterable: true,
    ),
  ],
);

void main() {
  late MockIsar mockIsar;
  late SharedPreferences prefs;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    mockIsar = MockIsar();
  });

  Widget buildCreateSubject() {
    return ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        isarProvider.overrideWithValue(mockIsar),
        entityConfigProvider.overrideWith((ref, slug) => _testConfig),
      ],
      child: const MaterialApp(home: EntityFormScreen(slug: 'products')),
    );
  }

  Widget buildEditSubject({required List<Override> overrides}) {
    return ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        isarProvider.overrideWithValue(mockIsar),
        entityConfigProvider.overrideWith((ref, slug) => _testConfig),
        ...overrides,
      ],
      child: const MaterialApp(
        home: EntityFormScreen(slug: 'products', id: '1'),
      ),
    );
  }

  testWidgets('shows "Create Product" title for new entity', (tester) async {
    await tester.pumpWidget(buildCreateSubject());
    await tester.pumpAndSettle();

    expect(find.text('Create Product'), findsOneWidget);
  });

  testWidgets('shows form fields from config', (tester) async {
    await tester.pumpWidget(buildCreateSubject());
    await tester.pumpAndSettle();

    // formFields excludes isAuto fields, so ID should not appear as a form field
    expect(find.text('Name'), findsOneWidget);
    expect(find.text('Price'), findsOneWidget);
    expect(find.text('Active'), findsOneWidget);
  });

  testWidgets('shows save button in app bar', (tester) async {
    await tester.pumpWidget(buildCreateSubject());
    await tester.pumpAndSettle();

    expect(find.text('Save'), findsOneWidget);
  });

  testWidgets('shows error state when fetching data fails', (tester) async {
    await tester.pumpWidget(
      buildEditSubject(
        overrides: [
          entityDetailProvider.overrideWith(
            (ref, params) => throw Exception('Network error'),
          ),
        ],
      ),
    );
    await tester.pump();

    expect(find.text('Something went wrong'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('shows "Edit" title for edit mode', (tester) async {
    await tester.pumpWidget(
      buildEditSubject(
        overrides: [
          entityDetailProvider.overrideWith(
            (ref, params) async =>
                {'id': 1, 'name': 'Existing', 'price': 5.0, 'active': true},
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('Edit'), findsAtLeastNWidgets(1));
  });

  testWidgets('pre-fills form fields from existing data', (tester) async {
    await tester.pumpWidget(
      buildEditSubject(
        overrides: [
          entityDetailProvider.overrideWith(
            (ref, params) async =>
                {'id': 1, 'name': 'WidgetX', 'price': 12.5, 'active': true},
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('WidgetX'), findsOneWidget);
    expect(find.text('12.5'), findsOneWidget);
  });

  testWidgets('save button is tappable in create mode', (tester) async {
    await tester.pumpWidget(buildCreateSubject());
    await tester.pumpAndSettle();

    final save = find.text('Save');
    expect(save, findsOneWidget);
    await tester.tap(save);
    await tester.pump();
  });
}
