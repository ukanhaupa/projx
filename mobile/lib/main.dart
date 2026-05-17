import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:projx_mobile/app.dart';
import 'package:projx_mobile/core/config/app_config.dart';
import 'package:projx_mobile/core/notifications/push_notification_service.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final prefs = await SharedPreferences.getInstance();
  final config = AppConfig.fromEnvironment();

  if (config.fcmEnabled) {
    final pushService = PushNotificationService();
    await pushService.initialize();
  }

  final container = ProviderContainer(
    overrides: [
      sharedPreferencesProvider.overrideWithValue(prefs),
    ],
  );

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const ProjectTemplateApp(),
    ),
  );
}
