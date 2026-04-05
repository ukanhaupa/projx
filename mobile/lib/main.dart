import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:isar/isar.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:projx_mobile/app.dart';
import 'package:projx_mobile/core/config/app_config.dart';
import 'package:projx_mobile/core/notifications/push_notification_service.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';
import 'package:projx_mobile/entities/base/offline/cached_entity.dart';
import 'package:projx_mobile/entities/base/offline/pending_mutation.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final prefs = await SharedPreferences.getInstance();
  final config = AppConfig.fromEnvironment();

  final dir = await getApplicationDocumentsDirectory();
  final isar = await Isar.open([
    CachedEntitySchema,
    PendingMutationSchema,
  ], directory: dir.path);

  if (config.fcmEnabled) {
    final pushService = PushNotificationService();
    await pushService.initialize();
  }

  final container = ProviderContainer(
    overrides: [
      sharedPreferencesProvider.overrideWithValue(prefs),
      isarProvider.overrideWithValue(isar),
    ],
  );

  container.read(syncServiceProvider).startListening();

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const ProjectTemplateApp(),
    ),
  );
}
