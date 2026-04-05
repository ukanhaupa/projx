import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/shared/widgets/confirm_dialog.dart';

void main() {
  group('ConfirmDialog', () {
    testWidgets('shows title and description', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(
            splashFactory: InkRipple.splashFactory,
          ),
          home: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => ConfirmDialog.show(
                context,
                title: 'Delete?',
                description: 'Cannot undo this.',
              ),
              child: const Text('Open'),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('Delete?'), findsOneWidget);
      expect(find.text('Cannot undo this.'), findsOneWidget);
    });

    testWidgets('returns true on confirm', (tester) async {
      bool? result;

      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(
            splashFactory: InkRipple.splashFactory,
          ),
          home: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () async {
                result = await ConfirmDialog.show(context, title: 'Confirm?');
              },
              child: const Text('Open'),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Confirm'));
      await tester.pumpAndSettle();

      expect(result, true);
    });

    testWidgets('returns false on cancel', (tester) async {
      bool? result;

      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(
            splashFactory: InkRipple.splashFactory,
          ),
          home: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () async {
                result = await ConfirmDialog.show(context, title: 'Confirm?');
              },
              child: const Text('Open'),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(result, false);
    });
  });
}
