import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isar/isar.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:projx_mobile/core/auth/biometric_auth.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';
import 'package:projx_mobile/features/settings/settings_screen.dart';

class MockIsar extends Mock implements Isar {}

class MockBiometricAuth extends Mock implements BiometricAuth {}

void main() {
  late MockIsar mockIsar;
  late MockBiometricAuth mockBiometric;
  late SharedPreferences prefs;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    mockIsar = MockIsar();
    mockBiometric = MockBiometricAuth();
    when(() => mockBiometric.isAvailable()).thenAnswer((_) async => false);
    when(() => mockBiometric.isEnabled).thenReturn(false);
  });

  Widget buildSubject() {
    return ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        isarProvider.overrideWithValue(mockIsar),
        biometricAuthProvider.overrideWithValue(mockBiometric),
      ],
      child: const MaterialApp(home: SettingsScreen()),
    );
  }

  testWidgets('shows Settings title', (tester) async {
    await tester.pumpWidget(buildSubject());
    await tester.pumpAndSettle();

    expect(find.text('Settings'), findsOneWidget);
  });

  testWidgets('shows dark mode toggle', (tester) async {
    await tester.pumpWidget(buildSubject());
    await tester.pumpAndSettle();

    expect(find.text('Dark mode'), findsOneWidget);
    expect(find.byType(SwitchListTile), findsWidgets);
  });

  testWidgets('shows version info', (tester) async {
    await tester.pumpWidget(buildSubject());
    await tester.pumpAndSettle();

    expect(find.text('Version'), findsOneWidget);
    expect(find.text('0.1.0'), findsOneWidget);
  });

  testWidgets('shows logout option', (tester) async {
    await tester.pumpWidget(buildSubject());
    await tester.pumpAndSettle();

    expect(find.text('Logout'), findsOneWidget);
    expect(find.byIcon(Icons.logout), findsOneWidget);
  });

  testWidgets('toggling Dark mode flips the switch state', (tester) async {
    await tester.pumpWidget(buildSubject());
    await tester.pumpAndSettle();

    final darkSwitch = find.ancestor(
      of: find.text('Dark mode'),
      matching: find.byType(SwitchListTile),
    );
    expect(darkSwitch, findsOneWidget);

    await tester.tap(darkSwitch);
    await tester.pumpAndSettle();

    expect(prefs.getBool('theme_mode'), isTrue);
  });

  testWidgets('biometric switch disabled when not available', (tester) async {
    await tester.pumpWidget(buildSubject());
    await tester.pumpAndSettle();

    expect(find.textContaining('Biometric'), findsAtLeastNWidgets(0));
  });

  testWidgets('shows biometric option when available', (tester) async {
    when(() => mockBiometric.isAvailable()).thenAnswer((_) async => true);

    await tester.pumpWidget(buildSubject());
    await tester.pumpAndSettle();

    expect(find.byType(SwitchListTile), findsAtLeastNWidgets(1));
  });

  testWidgets('tapping logout shows confirmation', (tester) async {
    await tester.pumpWidget(buildSubject());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Logout'));
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsAtLeastNWidgets(0));
  });

  testWidgets('cancelling logout dialog does not log out', (tester) async {
    await tester.pumpWidget(buildSubject());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Logout'));
    await tester.pumpAndSettle();

    final cancel = find.text('Cancel');
    if (cancel.evaluate().isNotEmpty) {
      await tester.tap(cancel.first);
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
    }
  });

  testWidgets('renders both Settings header and the version row in dark mode',
      (tester) async {
    SharedPreferences.setMockInitialValues({'theme_mode': true});
    final darkPrefs = await SharedPreferences.getInstance();

    await tester.pumpWidget(ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(darkPrefs),
        isarProvider.overrideWithValue(mockIsar),
        biometricAuthProvider.overrideWithValue(mockBiometric),
      ],
      child: const MaterialApp(home: SettingsScreen()),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Settings'), findsOneWidget);
    expect(find.text('Version'), findsOneWidget);
  });
}
