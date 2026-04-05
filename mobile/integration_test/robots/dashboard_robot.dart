import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class DashboardRobot {
  DashboardRobot(this.tester);
  final WidgetTester tester;

  void expectEntityCard(String entityName) {
    expect(find.text(entityName), findsOneWidget);
  }

  void expectEntityCardCount(int count) {
    expect(find.byType(Card), findsNWidgets(count));
  }

  void expectNoEntitiesMessage() {
    expect(find.text('No entities configured'), findsOneWidget);
  }

  Future<void> tapEntityCard(String entityName) async {
    await tester.tap(find.text(entityName));
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
