import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/shared/widgets/empty_state.dart';

void main() {
  group('EmptyState', () {
    testWidgets('renders title and description', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: EmptyState(
              title: 'No items yet',
              description: 'Create your first item.',
            ),
          ),
        ),
      );

      expect(find.text('No items yet'), findsOneWidget);
      expect(find.text('Create your first item.'), findsOneWidget);
    });

    testWidgets('renders action button when provided', (tester) async {
      var tapped = false;

      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(
            splashFactory: InkRipple.splashFactory,
          ),
          home: Scaffold(
            body: EmptyState(
              title: 'Empty',
              actionLabel: 'Create',
              onAction: () => tapped = true,
            ),
          ),
        ),
      );

      expect(find.text('Create'), findsOneWidget);
      await tester.tap(find.text('Create'));
      expect(tapped, true);
    });

    testWidgets('does not render action button without callback', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: EmptyState(title: 'Empty')),
        ),
      );

      expect(find.byType(ElevatedButton), findsNothing);
    });

    testWidgets('renders custom icon', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: EmptyState(icon: Icons.search, title: 'No results'),
          ),
        ),
      );

      expect(find.byIcon(Icons.search), findsOneWidget);
    });
  });
}
