import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:projx_mobile/core/routing/routes.dart';
import 'package:projx_mobile/core/theme/spacing.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/entities/base/entity_providers.dart';
import 'package:projx_mobile/entities/entity_overrides.dart';
import 'package:projx_mobile/shared/widgets/empty_state.dart';
import 'package:projx_mobile/shared/widgets/error_state.dart';
import 'package:projx_mobile/shared/widgets/loading_indicator.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final entityConfigs = ref.watch(entityConfigsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        leading: Builder(
          builder: (context) => IconButton(
            icon: const Icon(Icons.menu),
            onPressed: () => Scaffold.of(context).openDrawer(),
          ),
        ),
      ),
      body: entityConfigs.when(
        data: (configs) {
          if (configs.isEmpty) {
            return const EmptyState(
              icon: Icons.dashboard_outlined,
              title: 'No entities configured',
              description:
                  'Configure entities in your backend to see them here.',
            );
          }
          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(entityConfigsProvider);
            },
            child: GridView.builder(
              padding: Spacing.pagePadding,
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 220,
                mainAxisSpacing: Spacing.md,
                crossAxisSpacing: Spacing.md,
                childAspectRatio: 1.2,
              ),
              itemCount: configs.length,
              itemBuilder: (context, index) =>
                  _EntityCard(config: configs[index]),
            ),
          );
        },
        loading: () => GridView.builder(
          padding: Spacing.pagePadding,
          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
            maxCrossAxisExtent: 220,
            mainAxisSpacing: Spacing.md,
            crossAxisSpacing: Spacing.md,
            childAspectRatio: 1.2,
          ),
          itemCount: 6,
          itemBuilder: (_, __) => const ShimmerCard(),
        ),
        error: (error, _) => ErrorState(
          error: error,
          onRetry: () => ref.invalidate(entityConfigsProvider),
        ),
      ),
    );
  }
}

class _EntityCard extends StatelessWidget {
  final EntityConfig config;

  const _EntityCard({required this.config});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final icon = EntityOverrides.getIcon(config.slug);

    return Card(
      child: InkWell(
        onTap: () => context.go(Routes.entityList(config.slug)),
        borderRadius: Spacing.borderRadiusLg,
        child: Padding(
          padding: Spacing.cardPadding,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 32, color: theme.colorScheme.primary),
              const SizedBox(height: Spacing.sm),
              Text(
                config.namePlural,
                style: theme.textTheme.titleSmall,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: Spacing.xs),
              Text(
                config.isReadOnly ? 'Read Only' : 'Full CRUD',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
