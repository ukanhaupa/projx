import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:projx_mobile/core/routing/routes.dart';
import 'package:projx_mobile/core/theme/spacing.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/entities/base/entity_providers.dart';
import 'package:projx_mobile/entities/entity_overrides.dart';
import 'package:projx_mobile/shared/widgets/confirm_dialog.dart';
import 'package:projx_mobile/shared/widgets/error_state.dart';
import 'package:projx_mobile/shared/widgets/loading_indicator.dart';
import 'package:projx_mobile/shared/widgets/toast.dart';

class EntityDetailScreen extends ConsumerWidget {
  final String slug;
  final String id;

  const EntityDetailScreen({super.key, required this.slug, required this.id});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(entityConfigProvider(slug));
    final override = EntityOverrides.get(slug);
    final detailParams = EntityDetailParams(
      slug: slug,
      id: id,
      expand: override?.detailExpandFields,
    );
    final detailData = ref.watch(entityDetailProvider(detailParams));

    return Scaffold(
      body: detailData.when(
        data: (item) {
          if (override?.detailBuilder != null && config != null) {
            return override!.detailBuilder!(context, config, item);
          }
          return _buildDefaultDetail(context, ref, config, item);
        },
        loading: () => const LoadingIndicator(),
        error: (error, _) => ErrorState(
          error: error,
          onRetry: () => ref.invalidate(entityDetailProvider(detailParams)),
        ),
      ),
      bottomNavigationBar: detailData.when(
        data: (_) => _buildBottomBar(context, ref),
        loading: () => null,
        error: (_, __) => null,
      ),
    );
  }

  Widget _buildDefaultDetail(
    BuildContext context,
    WidgetRef ref,
    EntityConfig? config,
    Map<String, dynamic> item,
  ) {
    final title = _getTitle(config, item);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(
          entityDetailProvider(EntityDetailParams(slug: slug, id: id)),
        );
      },
      child: CustomScrollView(
        slivers: [
          SliverAppBar(
            expandedHeight: 120,
            pinned: true,
            flexibleSpace: FlexibleSpaceBar(
              title: Text(title, style: const TextStyle(fontSize: 16)),
            ),
          ),
          SliverPadding(
            padding: Spacing.pagePadding,
            sliver: SliverList(
              delegate: SliverChildListDelegate(
                _buildFieldList(context, config, item),
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _buildFieldList(
    BuildContext context,
    EntityConfig? config,
    Map<String, dynamic> item,
  ) {
    final fields = config?.visibleFields ?? [];

    if (fields.isEmpty) {
      return item.entries
          .map(
            (entry) => _buildFieldTile(
              context,
              entry.key,
              _formatValue(entry.value),
              isAuto: false,
            ),
          )
          .toList();
    }

    return fields.map((field) {
      final value = item[field.key];
      final expanded = item[field.key.replaceAll('_id', '')];

      String displayValue;
      if (field.hasForeignKey && expanded is Map) {
        displayValue = expanded['name']?.toString() ??
            expanded['title']?.toString() ??
            expanded['label']?.toString() ??
            expanded['id']?.toString() ??
            '-';
      } else {
        displayValue = _formatValue(value, fieldType: field.fieldType);
      }

      return _buildFieldTile(
        context,
        field.label,
        displayValue,
        isAuto: field.isAuto,
      );
    }).toList();
  }

  Widget _buildFieldTile(
    BuildContext context,
    String label,
    String value, {
    bool isAuto = false,
  }) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: Spacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
            ),
          ),
          const SizedBox(height: Spacing.xs),
          Text(
            value,
            style: theme.textTheme.bodyLarge?.copyWith(
              color: isAuto
                  ? theme.colorScheme.onSurface.withValues(alpha: 0.7)
                  : null,
            ),
          ),
          const Divider(),
        ],
      ),
    );
  }

  Widget _buildBottomBar(BuildContext context, WidgetRef ref) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(Spacing.md),
        child: Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => context.go(Routes.entityEdit(slug, id)),
                icon: const Icon(Icons.edit_outlined),
                label: const Text('Edit'),
              ),
            ),
            const SizedBox(width: Spacing.md),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => _handleDelete(context, ref),
                icon: Icon(
                  Icons.delete_outlined,
                  color: Theme.of(context).colorScheme.error,
                ),
                label: Text(
                  'Delete',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
                style: OutlinedButton.styleFrom(
                  side: BorderSide(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _handleDelete(BuildContext context, WidgetRef ref) async {
    final confirmed = await ConfirmDialog.show(
      context,
      title: 'Delete item?',
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      variant: ConfirmDialogVariant.danger,
    );

    if (!confirmed || !context.mounted) return;

    try {
      final service = ref.read(entityServiceProvider(slug));
      await service.delete(id);
      if (!context.mounted) return;
      AppToast.show(context, message: 'Item deleted', type: ToastType.success);
      context.go(Routes.entityList(slug));
    } catch (e) {
      if (!context.mounted) return;
      AppToast.show(
        context,
        message: 'Failed to delete',
        type: ToastType.error,
      );
    }
  }

  String _getTitle(EntityConfig? config, Map<String, dynamic> item) {
    if (config?.primaryField != null) {
      return item[config!.primaryField!.key]?.toString() ?? 'Detail';
    }
    return item['name']?.toString() ??
        item['title']?.toString() ??
        item['label']?.toString() ??
        'Detail #$id';
  }

  String _formatValue(dynamic value, {FieldType? fieldType}) {
    if (value == null) return '-';
    if (value is bool) return value ? 'Yes' : 'No';
    if (fieldType == FieldType.date && value is String) {
      try {
        final date = DateTime.parse(value);
        return DateFormat.yMMMd().format(date);
      } catch (_) {
        return value;
      }
    }
    if (fieldType == FieldType.datetime && value is String) {
      try {
        final date = DateTime.parse(value);
        return DateFormat.yMMMd().add_jm().format(date);
      } catch (_) {
        return value;
      }
    }
    return value.toString();
  }
}
