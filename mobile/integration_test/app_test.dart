import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:projx_mobile/core/network/api_client.dart';

import 'robots/app_robot.dart';
import 'robots/dashboard_robot.dart';
import 'robots/entity_detail_robot.dart';
import 'robots/entity_form_robot.dart';
import 'robots/entity_list_robot.dart';
import 'robots/settings_robot.dart';
import 'test_helpers.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  late TestApp testApp;

  setUp(() async {
    testApp = TestApp();
    await testApp.setUp();
  });

  group('Dashboard', () {
    testWidgets('shows entity cards after login', (tester) async {
      await testApp.pumpApp(tester);
      final app = AppRobot(tester);
      final dashboard = DashboardRobot(tester);

      app.expectOnDashboard();
      dashboard.expectEntityCard('Test Items');
    });

    testWidgets('shows empty state when no entities configured', (
      tester,
    ) async {
      when(
        () => testApp.apiClient.fetchMeta(),
      ).thenAnswer((_) async => <Map<String, dynamic>>[]);
      await testApp.pumpApp(tester);
      final dashboard = DashboardRobot(tester);

      dashboard.expectNoEntitiesMessage();
    });

    testWidgets('tapping entity card navigates to list', (tester) async {
      await testApp.pumpApp(tester);
      final dashboard = DashboardRobot(tester);
      final entityList = EntityListRobot(tester);

      await dashboard.tapEntityCard('Test Items');
      entityList.expectItemVisible('Item A');
      entityList.expectItemVisible('Item B');
    });
  });

  group('Entity List', () {
    testWidgets('shows items from API', (tester) async {
      await testApp.pumpApp(tester);
      final dashboard = DashboardRobot(tester);
      final entityList = EntityListRobot(tester);

      await dashboard.tapEntityCard('Test Items');
      entityList.expectItemVisible('Item A');
      entityList.expectItemVisible('Item B');
    });

    testWidgets('search filters results', (tester) async {
      when(
        () => testApp.apiClient.list(
          'test-items',
          page: any(named: 'page'),
          pageSize: any(named: 'pageSize'),
          search: 'Item A',
          orderBy: any(named: 'orderBy'),
          filters: any(named: 'filters'),
          expand: any(named: 'expand'),
        ),
      ).thenAnswer(
        (_) async => PaginatedResult<Map<String, dynamic>>(
          data: [testItems[0]],
          pagination: const PaginationInfo(
            currentPage: 1,
            pageSize: 20,
            totalPages: 1,
            totalRecords: 1,
          ),
        ),
      );

      await testApp.pumpApp(tester);
      final dashboard = DashboardRobot(tester);
      final entityList = EntityListRobot(tester);

      await dashboard.tapEntityCard('Test Items');
      await entityList.searchFor('Item A');
    });

    testWidgets('shows empty state when no items', (tester) async {
      when(
        () => testApp.apiClient.list(
          any(),
          page: any(named: 'page'),
          pageSize: any(named: 'pageSize'),
          search: any(named: 'search'),
          orderBy: any(named: 'orderBy'),
          filters: any(named: 'filters'),
          expand: any(named: 'expand'),
        ),
      ).thenAnswer(
        (_) async => const PaginatedResult<Map<String, dynamic>>(
          data: [],
          pagination: PaginationInfo(
            currentPage: 1,
            pageSize: 20,
            totalPages: 0,
            totalRecords: 0,
          ),
        ),
      );

      await testApp.pumpApp(tester);
      final dashboard = DashboardRobot(tester);
      final entityList = EntityListRobot(tester);

      await dashboard.tapEntityCard('Test Items');
      entityList.expectEmptyState();
    });

    testWidgets('FAB opens create form', (tester) async {
      await testApp.pumpApp(tester);
      final dashboard = DashboardRobot(tester);
      final entityList = EntityListRobot(tester);
      final form = EntityFormRobot(tester);

      await dashboard.tapEntityCard('Test Items');
      await entityList.tapCreateFab();
      form.expectCreateTitle('Test Item');
    });
  });

  group('Entity Detail', () {
    testWidgets('tapping item shows detail view', (tester) async {
      await testApp.pumpApp(tester);
      final dashboard = DashboardRobot(tester);
      final entityList = EntityListRobot(tester);
      final detail = EntityDetailRobot(tester);

      await dashboard.tapEntityCard('Test Items');
      await entityList.tapItem('Item A');
      detail.expectFieldValue('Item A');
    });

    testWidgets('edit button navigates to form', (tester) async {
      await testApp.pumpApp(tester);
      final dashboard = DashboardRobot(tester);
      final entityList = EntityListRobot(tester);
      final detail = EntityDetailRobot(tester);
      final form = EntityFormRobot(tester);

      await dashboard.tapEntityCard('Test Items');
      await entityList.tapItem('Item A');
      await detail.tapEdit();
      form.expectEditTitle('Test Item');
    });

    testWidgets('delete shows confirm dialog and cancels', (tester) async {
      await testApp.pumpApp(tester);
      final dashboard = DashboardRobot(tester);
      final entityList = EntityListRobot(tester);
      final detail = EntityDetailRobot(tester);

      await dashboard.tapEntityCard('Test Items');
      await entityList.tapItem('Item A');
      await detail.tapDelete();
      expect(find.text('Cancel'), findsOneWidget);
      await detail.cancelDelete();
    });
  });

  group('Entity Form', () {
    testWidgets('create form saves new entity', (tester) async {
      await testApp.pumpApp(tester);
      final dashboard = DashboardRobot(tester);
      final entityList = EntityListRobot(tester);
      final form = EntityFormRobot(tester);

      await dashboard.tapEntityCard('Test Items');
      await entityList.tapCreateFab();
      await form.fillTextField('Name', 'New Item');
      await form.fillTextField('Value', '5.99');
      await form.tapSave();
    });
  });

  group('Settings', () {
    testWidgets('navigates to settings page', (tester) async {
      await testApp.pumpApp(tester);
      final app = AppRobot(tester);
      final settings = SettingsRobot(tester);

      await app.navigateToSettings();
      settings.expectSettingsPage();
    });

    testWidgets('dark mode toggle switches theme', (tester) async {
      await testApp.pumpApp(tester);
      final app = AppRobot(tester);
      final settings = SettingsRobot(tester);

      await app.navigateToSettings();
      await settings.toggleDarkMode();
    });

    testWidgets('logout confirmation dialog shows and cancels', (tester) async {
      await testApp.pumpApp(tester);
      final app = AppRobot(tester);
      final settings = SettingsRobot(tester);

      await app.navigateToSettings();
      await settings.tapLogout();
      expect(find.text('Cancel'), findsOneWidget);
      await settings.cancelLogout();
      settings.expectSettingsPage();
    });
  });

  group('Navigation', () {
    testWidgets('drawer opens and shows all entity links', (tester) async {
      await testApp.pumpApp(tester);
      final app = AppRobot(tester);

      await app.openDrawer();
      expect(find.text('Dashboard'), findsWidgets);
      expect(find.text('Test Items'), findsWidgets);
      expect(find.text('Settings'), findsOneWidget);
    });

    testWidgets('navigates between dashboard and entity list', (tester) async {
      await testApp.pumpApp(tester);
      final app = AppRobot(tester);
      final entityList = EntityListRobot(tester);

      await app.navigateToEntityList('Test Items');
      entityList.expectItemVisible('Item A');
    });
  });

  group('Auth', () {
    testWidgets('unauthenticated user sees login screen', (tester) async {
      await testApp.setUp(authenticated: false);
      await testApp.pumpAppUnauthenticated(tester);

      expect(find.text('Welcome'), findsOneWidget);
      expect(find.text('Sign in with SSO'), findsOneWidget);
    });
  });
}
