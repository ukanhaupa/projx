import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class SettingsRobot {
  SettingsRobot(this.tester);
  final WidgetTester tester;

  void expectSettingsPage() {
    expect(find.text('Settings'), findsOneWidget);
    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('Account'), findsOneWidget);
  }

  Future<void> toggleDarkMode() async {
    final darkModeSwitch = find.widgetWithText(SwitchListTile, 'Dark mode');
    await tester.tap(darkModeSwitch);
    await tester.pumpAndSettle();
  }

  void expectDarkModeIcon() {
    expect(find.byIcon(Icons.dark_mode), findsOneWidget);
  }

  void expectLightModeIcon() {
    expect(find.byIcon(Icons.light_mode), findsOneWidget);
  }

  Future<void> tapLogout() async {
    await tester.tap(find.text('Logout'));
    await tester.pumpAndSettle();
  }

  Future<void> confirmLogout() async {
    await tester.tap(find.text('Logout').last);
    await tester.pumpAndSettle();
  }

  Future<void> cancelLogout() async {
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
  }
}
