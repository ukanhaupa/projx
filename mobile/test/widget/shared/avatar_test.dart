import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/shared/widgets/avatar.dart';

void main() {
  group('AppAvatar', () {
    testWidgets('displays initials from full name', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: AppAvatar(name: 'John Doe')),
        ),
      );

      expect(find.text('JD'), findsOneWidget);
    });

    testWidgets('displays single initial from first name', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: AppAvatar(name: 'Alice')),
        ),
      );

      expect(find.text('A'), findsOneWidget);
    });

    testWidgets('displays ? for null name', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: AppAvatar())),
      );

      expect(find.text('?'), findsOneWidget);
    });

    testWidgets('respects custom size', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: AppAvatar(name: 'Test', size: 60)),
        ),
      );

      final avatar = tester.widget<CircleAvatar>(find.byType(CircleAvatar));
      expect(avatar.radius, 30);
    });
  });
}
