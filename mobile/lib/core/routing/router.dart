import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';
import 'package:projx_mobile/core/routing/routes.dart';
import 'package:projx_mobile/features/auth/login_screen.dart';
import 'package:projx_mobile/features/auth/splash_screen.dart';
import 'package:projx_mobile/features/dashboard/dashboard_screen.dart';
import 'package:projx_mobile/features/entity/entity_detail_screen.dart';
import 'package:projx_mobile/features/entity/entity_form_screen.dart';
import 'package:projx_mobile/features/entity/entity_list_screen.dart';
import 'package:projx_mobile/features/settings/settings_screen.dart';
import 'package:projx_mobile/shared/widgets/app_scaffold.dart';

GoRouter createRouter(WidgetRef ref) {
  return GoRouter(
    initialLocation: Routes.splash,
    redirect: (context, state) {
      final authState = ref.read(authStateProvider);
      final isSplash = state.matchedLocation == Routes.splash;
      final isLogin = state.matchedLocation == Routes.login;

      if (isSplash) return null;

      return authState.when(
        data: (isAuthenticated) {
          if (!isAuthenticated && !isLogin) return Routes.login;
          if (isAuthenticated && isLogin) return Routes.dashboard;
          return null;
        },
        loading: () => null,
        error: (_, __) => Routes.login,
      );
    },
    routes: [
      GoRoute(path: Routes.splash, builder: (_, __) => const SplashScreen()),
      GoRoute(path: Routes.login, builder: (_, __) => const LoginScreen()),
      ShellRoute(
        builder: (_, __, child) => AppScaffold(child: child),
        routes: [
          GoRoute(
            path: Routes.dashboard,
            builder: (_, __) => const DashboardScreen(),
          ),
          GoRoute(
            path: Routes.settings,
            builder: (_, __) => const SettingsScreen(),
          ),
          GoRoute(
            path: '/entities/:slug',
            builder: (_, state) =>
                EntityListScreen(slug: state.pathParameters['slug']!),
            routes: [
              GoRoute(
                path: 'new',
                builder: (_, state) =>
                    EntityFormScreen(slug: state.pathParameters['slug']!),
              ),
              GoRoute(
                path: ':id',
                builder: (_, state) => EntityDetailScreen(
                  slug: state.pathParameters['slug']!,
                  id: state.pathParameters['id']!,
                ),
                routes: [
                  GoRoute(
                    path: 'edit',
                    builder: (_, state) => EntityFormScreen(
                      slug: state.pathParameters['slug']!,
                      id: state.pathParameters['id']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
    errorBuilder: (_, state) => Scaffold(
      body: Center(child: Text('Page not found: ${state.matchedLocation}')),
    ),
  );
}
