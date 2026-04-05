import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';
import 'package:projx_mobile/core/routing/routes.dart';
import 'package:projx_mobile/core/theme/app_theme.dart';
import 'package:projx_mobile/core/theme/color_tokens.dart';
import 'package:projx_mobile/core/theme/spacing.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/entities/base/entity_providers.dart';
import 'package:projx_mobile/entities/entity_overrides.dart';
import 'package:projx_mobile/features/offline/sync_indicator.dart';

class AppScaffold extends ConsumerWidget {
  final Widget child;

  const AppScaffold({super.key, required this.child});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isPhone = Breakpoints.isPhone(context);
    final entityConfigs = ref.watch(entityConfigsProvider);
    final isOnline = ref.watch(isOnlineProvider);

    return Scaffold(
      body: Column(
        children: [
          if (!isOnline) const SyncIndicator(),
          Expanded(child: child),
        ],
      ),
      drawer: isPhone ? _buildDrawer(context, ref, entityConfigs) : null,
      bottomNavigationBar: isPhone ? _buildBottomNav(context) : null,
    );
  }

  Widget? _buildDrawer(
    BuildContext context,
    WidgetRef ref,
    AsyncValue<List<EntityConfig>> entityConfigs,
  ) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bgColor = isDark ? ColorTokens.sidebarBgDark : ColorTokens.sidebarBg;
    final textColor =
        isDark ? ColorTokens.sidebarTextDark : ColorTokens.sidebarText;
    final activeTextColor = isDark
        ? ColorTokens.sidebarTextActiveDark
        : ColorTokens.sidebarTextActive;

    return Drawer(
      backgroundColor: bgColor,
      width: AppLayout.drawerWidth,
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(Spacing.md),
              child: Row(
                children: [
                  Icon(Icons.dashboard_outlined, color: activeTextColor),
                  const SizedBox(width: Spacing.sm),
                  Text(
                    'Project Template',
                    style: Theme.of(
                      context,
                    ).textTheme.titleMedium?.copyWith(color: activeTextColor),
                  ),
                ],
              ),
            ),
            const Divider(color: ColorTokens.sidebarBorder),
            _DrawerItem(
              icon: Icons.dashboard_outlined,
              label: 'Dashboard',
              textColor: textColor,
              activeTextColor: activeTextColor,
              isActive: GoRouterState.of(context).matchedLocation == '/',
              onTap: () {
                Navigator.of(context).pop();
                context.go(Routes.dashboard);
              },
            ),
            entityConfigs.when(
              data: (configs) => Expanded(
                child: ListView(
                  padding: EdgeInsets.zero,
                  children: configs
                      .map(
                        (config) => _DrawerItem(
                          icon: EntityOverrides.getIcon(config.slug),
                          label: config.namePlural,
                          textColor: textColor,
                          activeTextColor: activeTextColor,
                          isActive: GoRouterState.of(context)
                              .matchedLocation
                              .startsWith('/entities/${config.slug}'),
                          onTap: () {
                            Navigator.of(context).pop();
                            context.go(Routes.entityList(config.slug));
                          },
                        ),
                      )
                      .toList(),
                ),
              ),
              loading: () => const Expanded(
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (_, __) => const SizedBox.shrink(),
            ),
            const Divider(color: ColorTokens.sidebarBorder),
            _DrawerItem(
              icon: Icons.settings_outlined,
              label: 'Settings',
              textColor: textColor,
              activeTextColor: activeTextColor,
              isActive:
                  GoRouterState.of(context).matchedLocation == '/settings',
              onTap: () {
                Navigator.of(context).pop();
                context.go(Routes.settings);
              },
            ),
            const SizedBox(height: Spacing.sm),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomNav(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    int currentIndex = 0;
    if (location.startsWith('/entities')) currentIndex = 1;
    if (location == '/settings') currentIndex = 2;

    return NavigationBar(
      selectedIndex: currentIndex,
      onDestinationSelected: (index) {
        switch (index) {
          case 0:
            context.go(Routes.dashboard);
          case 1:
            break;
          case 2:
            context.go(Routes.settings);
        }
      },
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.dashboard_outlined),
          selectedIcon: Icon(Icons.dashboard),
          label: 'Dashboard',
        ),
        NavigationDestination(
          icon: Icon(Icons.table_chart_outlined),
          selectedIcon: Icon(Icons.table_chart),
          label: 'Entities',
        ),
        NavigationDestination(
          icon: Icon(Icons.settings_outlined),
          selectedIcon: Icon(Icons.settings),
          label: 'Settings',
        ),
      ],
    );
  }
}

class _DrawerItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color textColor;
  final Color activeTextColor;
  final bool isActive;
  final VoidCallback onTap;

  const _DrawerItem({
    required this.icon,
    required this.label,
    required this.textColor,
    required this.activeTextColor,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(
        icon,
        color: isActive ? activeTextColor : textColor,
        size: 20,
      ),
      title: Text(
        label,
        style: TextStyle(
          color: isActive ? activeTextColor : textColor,
          fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
          fontSize: 14,
        ),
      ),
      tileColor: isActive ? Colors.white.withValues(alpha: 0.1) : null,
      onTap: onTap,
      dense: true,
      visualDensity: VisualDensity.compact,
    );
  }
}
