import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class AppRobot {
  AppRobot(this.tester);
  final WidgetTester tester;

  Future<void> waitForApp() async {
    await tester.pumpAndSettle(const Duration(seconds: 3));
  }

  Future<void> openDrawer() async {
    final menuButton = find.byIcon(Icons.menu);
    if (menuButton.evaluate().isNotEmpty) {
      await tester.tap(menuButton.first);
      await tester.pumpAndSettle();
    }
  }

  Future<void> navigateToSettings() async {
    await openDrawer();
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
  }

  Future<void> navigateToEntityList(String entityNamePlural) async {
    await openDrawer();
    final entityLink = find.text(entityNamePlural);
    if (entityLink.evaluate().isNotEmpty) {
      await tester.tap(entityLink.first);
      await tester.pumpAndSettle();
    }
  }

  void expectOnDashboard() {
    expect(find.text('Dashboard'), findsWidgets);
  }

  void expectOnSettings() {
    expect(find.text('Settings'), findsOneWidget);
    expect(find.text('Appearance'), findsOneWidget);
  }
}
