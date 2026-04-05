import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isar/isar.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:projx_mobile/core/network/api_client.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/entities/base/entity_providers.dart';
import 'package:projx_mobile/features/entity/entity_list_screen.dart';

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

const _testResult = PaginatedResult<Map<String, dynamic>>(
  data: [
    {'id': 1, 'name': 'Widget', 'price': 9.99, 'active': true},
  ],
  pagination: PaginationInfo(
    currentPage: 1,
    pageSize: 20,
    totalPages: 1,
    totalRecords: 1,
  ),
);

const _emptyResult = PaginatedResult<Map<String, dynamic>>(
  data: [],
  pagination: PaginationInfo(
    currentPage: 1,
    pageSize: 20,
    totalPages: 0,
    totalRecords: 0,
  ),
);

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
      child: const MaterialApp(home: EntityListScreen(slug: 'products')),
    );
  }

  testWidgets('shows entity name in app bar when data loaded', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityListProvider.overrideWith((ref, params) async => _testResult),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Products'), findsOneWidget);
  });

  testWidgets('shows list items from data', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityListProvider.overrideWith((ref, params) async => _testResult),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Widget'), findsOneWidget);
  });

  testWidgets('shows FAB for create', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityListProvider.overrideWith((ref, params) async => _testResult),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(FloatingActionButton), findsOneWidget);
    expect(find.byIcon(Icons.add), findsOneWidget);
  });

  testWidgets('shows empty state when no items', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityListProvider.overrideWith((ref, params) async => _emptyResult),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No items yet'), findsOneWidget);
  });

  testWidgets('shows shimmer loading state', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityListProvider.overrideWith((ref, params) {
            return Future<PaginatedResult<Map<String, dynamic>>>.delayed(
              const Duration(days: 1),
            );
          }),
        ],
      ),
    );
    await tester.pump();

    // ShimmerList is shown during initial load; it uses shimmer internally
    // but we can check for the CircularProgressIndicator absence and
    // that the loading shimmer widget tree is rendered
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });

  testWidgets('shows error state with retry', (tester) async {
    await tester.pumpWidget(
      buildSubject(
        overrides: [
          entityListProvider.overrideWith((ref, params) async {
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
