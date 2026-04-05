import 'package:flutter/material.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';

typedef ListTileBuilder = Widget Function(
  BuildContext context,
  EntityConfig config,
  Map<String, dynamic> item,
);

typedef DetailBuilder = Widget Function(
  BuildContext context,
  EntityConfig config,
  Map<String, dynamic> item,
);

typedef FormBuilder = Widget Function(
  BuildContext context,
  EntityConfig config,
  Map<String, dynamic>? initialData,
  void Function(Map<String, dynamic> data) onSubmit,
);

class EntityOverride {
  final IconData? icon;
  final ListTileBuilder? listTileBuilder;
  final DetailBuilder? detailBuilder;
  final FormBuilder? formBuilder;
  final List<String>? listExpandFields;
  final List<String>? detailExpandFields;
  final String? defaultOrderBy;
  final int? pageSize;

  const EntityOverride({
    this.icon,
    this.listTileBuilder,
    this.detailBuilder,
    this.formBuilder,
    this.listExpandFields,
    this.detailExpandFields,
    this.defaultOrderBy,
    this.pageSize,
  });
}

class EntityOverrides {
  static final Map<String, EntityOverride> _overrides = {};

  static void register(String slug, EntityOverride override) {
    _overrides[slug] = override;
  }

  static EntityOverride? get(String slug) => _overrides[slug];

  static IconData getIcon(String slug) {
    return _overrides[slug]?.icon ?? _defaultIcon(slug);
  }

  static IconData _defaultIcon(String slug) {
    // Common slugs get sensible defaults; override via EntityOverrides.register()
    return switch (slug) {
      'audit-logs' => Icons.history_outlined,
      _ => Icons.table_chart_outlined,
    };
  }
}
