import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class EntityFormRobot {
  EntityFormRobot(this.tester);
  final WidgetTester tester;

  void expectCreateTitle(String entityName) {
    expect(find.text('Create $entityName'), findsOneWidget);
  }

  void expectEditTitle(String entityName) {
    expect(find.text('Edit $entityName'), findsOneWidget);
  }

  Future<void> fillTextField(String label, String value) async {
    final field = find.widgetWithText(TextFormField, label);
    await tester.enterText(field, value);
    await tester.pumpAndSettle();
  }

  Future<void> toggleBooleanField(String label) async {
    final switchTile = find.widgetWithText(SwitchListTile, label);
    await tester.tap(switchTile);
    await tester.pumpAndSettle();
  }

  Future<void> tapSave() async {
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle(const Duration(seconds: 2));
  }

  Future<void> tapBack() async {
    final backButton = find.byType(BackButton);
    if (backButton.evaluate().isNotEmpty) {
      await tester.tap(backButton);
      await tester.pumpAndSettle();
    } else {
      await tester.pageBack();
      await tester.pumpAndSettle();
    }
  }

  void expectFieldError(String errorText) {
    expect(find.text(errorText), findsOneWidget);
  }

  void expectSaving() {
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  }
}
