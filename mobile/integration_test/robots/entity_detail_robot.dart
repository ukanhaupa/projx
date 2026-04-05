import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class EntityDetailRobot {
  EntityDetailRobot(this.tester);
  final WidgetTester tester;

  void expectFieldValue(String value) {
    expect(find.text(value), findsWidgets);
  }

  Future<void> tapEdit() async {
    await tester.tap(find.byIcon(Icons.edit_outlined));
    await tester.pumpAndSettle();
  }

  Future<void> tapDelete() async {
    await tester.tap(find.byIcon(Icons.delete_outlined));
    await tester.pumpAndSettle();
  }

  Future<void> confirmDelete() async {
    final deleteButton = find.text('Delete');
    if (deleteButton.evaluate().length > 1) {
      await tester.tap(deleteButton.last);
    } else {
      await tester.tap(deleteButton);
    }
    await tester.pumpAndSettle();
  }

  Future<void> cancelDelete() async {
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
  }

  Future<void> pullToRefresh() async {
    await tester.fling(
      find.byType(RefreshIndicator),
      const Offset(0, 300),
      800,
    );
    await tester.pumpAndSettle();
  }
}
