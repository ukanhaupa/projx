import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isar/isar.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:projx_mobile/core/auth/auth_service.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';
import 'package:projx_mobile/features/auth/login_screen.dart';

class MockIsar extends Mock implements Isar {}

class MockAuthService extends Mock implements AuthService {}

void main() {
  late MockIsar mockIsar;
  late SharedPreferences prefs;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    mockIsar = MockIsar();
  });

  Widget buildSubject({MockAuthService? auth}) {
    return ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        isarProvider.overrideWithValue(mockIsar),
        if (auth != null) authServiceProvider.overrideWithValue(auth),
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

  testWidgets('disables button + shows spinner during login', (tester) async {
    final auth = MockAuthService();
    final completer = Completer<bool>();
    when(() => auth.login()).thenAnswer((_) => completer.future);

    await tester.pumpWidget(buildSubject(auth: auth));
    await tester.tap(find.byType(ElevatedButton));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
      isNull,
    );

    completer.complete(false);
    await tester.pumpAndSettle();
  });

  testWidgets('shows error toast when login throws', (tester) async {
    final auth = MockAuthService();
    when(() => auth.login()).thenThrow(Exception('boom'));

    await tester.pumpWidget(buildSubject(auth: auth));
    await tester.tap(find.byType(ElevatedButton));
    await tester.pump();
    await tester.pump();

    expect(find.textContaining('Login failed'), findsOneWidget);
  });

  testWidgets('shows toast when login returns false', (tester) async {
    final auth = MockAuthService();
    when(() => auth.login()).thenAnswer((_) async => false);

    await tester.pumpWidget(buildSubject(auth: auth));
    await tester.tap(find.byType(ElevatedButton));
    await tester.pump();
    await tester.pump();

    expect(find.textContaining('Login failed'), findsOneWidget);
  });
}
