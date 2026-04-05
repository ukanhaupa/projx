import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isar/isar.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';
import 'package:projx_mobile/features/auth/login_screen.dart';

class MockIsar extends Mock implements Isar {}

void main() {
  late MockIsar mockIsar;
  late SharedPreferences prefs;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    mockIsar = MockIsar();
  });

  Widget buildSubject() {
    return ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        isarProvider.overrideWithValue(mockIsar),
      ],
      child: const MaterialApp(home: LoginScreen()),
    );
  }

  testWidgets('shows welcome text and sign in button', (tester) async {
    await tester.pumpWidget(buildSubject());

    expect(find.text('Welcome'), findsOneWidget);
    expect(find.text('Sign in to continue'), findsOneWidget);
    expect(find.text('Sign in with SSO'), findsOneWidget);
  });

  testWidgets('shows lock icon', (tester) async {
    await tester.pumpWidget(buildSubject());

    expect(find.byIcon(Icons.lock_outlined), findsOneWidget);
  });

  testWidgets('button shows Sign in with SSO', (tester) async {
    await tester.pumpWidget(buildSubject());

    final button = find.byType(ElevatedButton);
    expect(button, findsOneWidget);
    expect(
      find.descendant(of: button, matching: find.text('Sign in with SSO')),
      findsOneWidget,
    );
  });
}
