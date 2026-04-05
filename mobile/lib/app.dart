import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';
import 'package:projx_mobile/core/routing/router.dart';
import 'package:projx_mobile/core/theme/app_theme.dart';

class ProjectTemplateApp extends ConsumerWidget {
  const ProjectTemplateApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = createRouter(ref);
    final themeState = ref.watch(themeModeProvider);

    return MaterialApp.router(
      title: 'Project Template',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: themeState.isDark ? ThemeMode.dark : ThemeMode.light,
      routerConfig: router,
    );
  }
}
