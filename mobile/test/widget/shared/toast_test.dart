import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/shared/widgets/toast.dart';

Widget _harness({required void Function(BuildContext) onPressed}) {
  return MaterialApp(
    home: Scaffold(
      body: Builder(
        builder: (ctx) => Center(
          child: ElevatedButton(
            onPressed: () => onPressed(ctx),
            child: const Text('show'),
          ),
        ),
      ),
    ),
  );
}

void main() {
  for (final type in ToastType.values) {
    testWidgets('shows ${type.name} toast', (tester) async {
      await tester.pumpWidget(_harness(
        onPressed: (ctx) => AppToast.show(
          ctx,
          message: '${type.name} message',
          type: type,
          duration: const Duration(milliseconds: 500),
        ),
      ));

      await tester.tap(find.text('show'));
      await tester.pump();

      expect(find.text('${type.name} message'), findsOneWidget);
      expect(find.byType(SnackBar), findsOneWidget);
      await tester.pump(const Duration(seconds: 1));
    });
  }

  testWidgets('renders correctly in dark mode', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: ThemeData(brightness: Brightness.dark),
      home: Scaffold(
        body: Builder(
          builder: (ctx) => ElevatedButton(
            onPressed: () => AppToast.show(
              ctx,
              message: 'dark',
              type: ToastType.warning,
            ),
            child: const Text('show'),
          ),
        ),
      ),
    ));

    await tester.tap(find.text('show'));
    await tester.pump();
    expect(find.text('dark'), findsOneWidget);
    await tester.pump(const Duration(seconds: 4));
  });
}
