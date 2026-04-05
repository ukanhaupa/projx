import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class EntityListRobot {
  EntityListRobot(this.tester);
  final WidgetTester tester;

  void expectTitle(String title) {
    expect(find.text(title), findsOneWidget);
  }

  void expectItemVisible(String text) {
    expect(find.text(text), findsOneWidget);
  }

  void expectItemCount(int count) {
    final listTiles = find.byType(ListTile);
    expect(listTiles, findsNWidgets(count));
  }

  void expectEmptyState() {
    expect(find.text('No items yet'), findsOneWidget);
  }

  Future<void> tapCreateFab() async {
    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();
  }

  Future<void> tapItem(String title) async {
    await tester.tap(find.text(title));
    await tester.pumpAndSettle();
  }

  Future<void> searchFor(String query) async {
    final searchField = find.byType(TextField);
    await tester.enterText(searchField, query);
    await tester.pumpAndSettle(const Duration(milliseconds: 500));
  }

  Future<void> clearSearch() async {
    final clearButton = find.byIcon(Icons.clear);
    if (clearButton.evaluate().isNotEmpty) {
      await tester.tap(clearButton);
      await tester.pumpAndSettle();
    }
  }

  Future<void> openFilterSheet() async {
    await tester.tap(find.byIcon(Icons.filter_list));
    await tester.pumpAndSettle();
  }

  Future<void> swipeToDelete(String title) async {
    await tester.drag(find.text(title), const Offset(-300, 0));
    await tester.pumpAndSettle();
  }

  Future<void> tapEditOnItem(String title) async {
    final listTile = find.ancestor(
      of: find.text(title),
      matching: find.byType(ListTile),
    );
    final editIcon = find.descendant(
      of: listTile,
      matching: find.byIcon(Icons.edit_outlined),
    );
    if (editIcon.evaluate().isNotEmpty) {
      await tester.tap(editIcon);
      await tester.pumpAndSettle();
    }
  }
}
