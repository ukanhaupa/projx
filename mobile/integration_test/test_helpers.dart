import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isar/isar.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:projx_mobile/app.dart';
import 'package:projx_mobile/core/auth/auth_service.dart';
import 'package:projx_mobile/core/network/api_client.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockAuthService extends Mock implements AuthService {}

class MockIsar extends Mock implements Isar {}

final testEntityMeta = [
  {
    'slug': 'test-items',
    'name': 'Test Item',
    'name_plural': 'Test Items',
    'fields': [
      {
        'key': 'id',
        'label': 'ID',
        'type': 'int',
        'field_type': 'number',
        'is_auto': true,
        'is_primary_key': true,
      },
      {'key': 'name', 'label': 'Name', 'type': 'str', 'field_type': 'text'},
      {
        'key': 'value',
        'label': 'Value',
        'type': 'float',
        'field_type': 'number',
      },
    ],
  },
];

final testItems = [
  {'id': 1, 'name': 'Item A', 'value': 9.99},
  {'id': 2, 'name': 'Item B', 'value': 19.99},
];

class TestApp {
  final MockApiClient apiClient = MockApiClient();
  final MockAuthService authService = MockAuthService();
  final MockIsar isar = MockIsar();
  late SharedPreferences prefs;

  Future<void> setUp({bool authenticated = true}) async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();

    when(
      () => authService.isAuthenticated(),
    ).thenAnswer((_) async => authenticated);

    when(() => apiClient.fetchMeta()).thenAnswer((_) async => testEntityMeta);

    when(
      () => apiClient.list(
        any(),
        page: any(named: 'page'),
        pageSize: any(named: 'pageSize'),
        search: any(named: 'search'),
        orderBy: any(named: 'orderBy'),
        filters: any(named: 'filters'),
        expand: any(named: 'expand'),
      ),
    ).thenAnswer(
      (_) async => PaginatedResult<Map<String, dynamic>>(
        data: testItems,
        pagination: const PaginationInfo(
          currentPage: 1,
          pageSize: 20,
          totalPages: 1,
          totalRecords: 2,
        ),
      ),
    );

    when(
      () => apiClient.getById(any(), any(), expand: any(named: 'expand')),
    ).thenAnswer((_) async => testItems[0]);

    when(
      () => apiClient.create(any(), any()),
    ).thenAnswer((_) async => {'id': 3, 'name': 'New Widget', 'price': 5.99});

    when(() => apiClient.update(any(), any(), any())).thenAnswer(
      (_) async => {'id': 1, 'name': 'Updated Widget', 'price': 12.99},
    );

    when(() => apiClient.delete(any(), any())).thenAnswer((_) async {});
  }

  Future<void> pumpApp(WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sharedPreferencesProvider.overrideWithValue(prefs),
          isarProvider.overrideWithValue(isar),
          apiClientProvider.overrideWithValue(apiClient),
          authServiceProvider.overrideWithValue(authService),
          authStateProvider.overrideWith((ref) async => true),
        ],
        child: const ProjectTemplateApp(),
      ),
    );
    await tester.pumpAndSettle(const Duration(seconds: 3));
  }

  Future<void> pumpAppUnauthenticated(WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sharedPreferencesProvider.overrideWithValue(prefs),
          isarProvider.overrideWithValue(isar),
          apiClientProvider.overrideWithValue(apiClient),
          authServiceProvider.overrideWithValue(authService),
          authStateProvider.overrideWith((ref) async => false),
        ],
        child: const ProjectTemplateApp(),
      ),
    );
    await tester.pumpAndSettle(const Duration(seconds: 3));
  }
}
