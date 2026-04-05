import 'package:flutter/material.dart';
import 'package:projx_mobile/core/theme/spacing.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/entities/entity_overrides.dart';
import 'package:projx_mobile/shared/widgets/avatar.dart';

class EntityListTile extends StatelessWidget {
  final EntityConfig config;
  final Map<String, dynamic> item;
  final EntityOverride? entityOverride;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const EntityListTile({
    super.key,
    required this.config,
    required this.item,
    this.entityOverride,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    if (entityOverride?.listTileBuilder != null) {
      return entityOverride!.listTileBuilder!(context, config, item);
    }

    final theme = Theme.of(context);
    final title = _getTitle();
    final subtitle = _getSubtitle();

    return Dismissible(
      key: Key('${config.slug}-${item['id']}'),
      direction: DismissDirection.endToStart,
      confirmDismiss: (_) async => true,
      onDismissed: (_) => onDelete(),
      background: Container(
        color: theme.colorScheme.error,
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: Spacing.lg),
        child: Icon(Icons.delete_outline, color: theme.colorScheme.onError),
      ),
      child: ListTile(
        leading: AppAvatar(name: title, size: 40),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: subtitle != null
            ? Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                ),
              )
            : null,
        trailing: IconButton(
          icon: const Icon(Icons.edit_outlined, size: 20),
          onPressed: onEdit,
        ),
        onTap: onTap,
      ),
    );
  }

  String _getTitle() {
    if (config.primaryField != null) {
      return item[config.primaryField!.key]?.toString() ?? 'Untitled';
    }
    return item['name']?.toString() ??
        item['title']?.toString() ??
        item['label']?.toString() ??
        '#${item['id']}';
  }

  String? _getSubtitle() {
    if (config.subtitleField != null) {
      return item[config.subtitleField!.key]?.toString();
    }
    return null;
  }
}
