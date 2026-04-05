import 'package:flutter/material.dart';
import 'package:projx_mobile/core/theme/spacing.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';

class EntityFilterSheet extends StatefulWidget {
  final EntityConfig config;
  final Map<String, String> currentFilters;
  final String? currentOrderBy;
  final void Function(Map<String, String> filters, String? orderBy) onApply;

  const EntityFilterSheet({
    super.key,
    required this.config,
    required this.currentFilters,
    this.currentOrderBy,
    required this.onApply,
  });

  @override
  State<EntityFilterSheet> createState() => _EntityFilterSheetState();
}

class _EntityFilterSheetState extends State<EntityFilterSheet> {
  late Map<String, String> _filters;
  String? _orderBy;
  final Map<String, TextEditingController> _controllers = {};

  @override
  void initState() {
    super.initState();
    _filters = Map.from(widget.currentFilters);
    _orderBy = widget.currentOrderBy;

    for (final field in widget.config.filterableFields) {
      _controllers[field.key] = TextEditingController(
        text: _filters[field.key] ?? '',
      );
    }
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final filterableFields = widget.config.filterableFields;
    final sortableFields = widget.config.fields
        .where((f) => f.filterable && !f.isPrimaryKey)
        .toList();

    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.3,
      maxChildSize: 0.9,
      expand: false,
      builder: (_, scrollController) => Padding(
        padding: Spacing.pagePadding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(bottom: Spacing.md),
                decoration: BoxDecoration(
                  color: theme.colorScheme.outline,
                  borderRadius: Spacing.borderRadiusFull,
                ),
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Filters & Sort', style: theme.textTheme.titleMedium),
                TextButton(
                  onPressed: () {
                    setState(() {
                      _filters.clear();
                      _orderBy = null;
                      for (final controller in _controllers.values) {
                        controller.clear();
                      }
                    });
                  },
                  child: const Text('Clear all'),
                ),
              ],
            ),
            const SizedBox(height: Spacing.md),
            if (sortableFields.isNotEmpty) ...[
              Text('Sort by', style: theme.textTheme.labelLarge),
              const SizedBox(height: Spacing.sm),
              Wrap(
                spacing: Spacing.sm,
                children: sortableFields.map((field) {
                  final isSelected =
                      _orderBy == field.key || _orderBy == '-${field.key}';
                  final isDesc = _orderBy?.startsWith('-') ?? false;
                  return FilterChip(
                    label: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(field.label),
                        if (isSelected)
                          Icon(
                            isDesc ? Icons.arrow_downward : Icons.arrow_upward,
                            size: 14,
                          ),
                      ],
                    ),
                    selected: isSelected,
                    onSelected: (_) {
                      setState(() {
                        if (_orderBy == field.key) {
                          _orderBy = '-${field.key}';
                        } else if (_orderBy == '-${field.key}') {
                          _orderBy = null;
                        } else {
                          _orderBy = field.key;
                        }
                      });
                    },
                  );
                }).toList(),
              ),
              const SizedBox(height: Spacing.lg),
            ],
            Expanded(
              child: ListView(
                controller: scrollController,
                children: filterableFields.map((field) {
                  if (field.fieldType == FieldType.boolean) {
                    return _buildBooleanFilter(field);
                  }
                  if (field.fieldType == FieldType.select &&
                      field.options != null) {
                    return _buildSelectFilter(field);
                  }
                  return Padding(
                    padding: const EdgeInsets.only(bottom: Spacing.md),
                    child: TextField(
                      controller: _controllers[field.key],
                      decoration: InputDecoration(labelText: field.label),
                      onChanged: (val) {
                        if (val.isEmpty) {
                          _filters.remove(field.key);
                        } else {
                          _filters[field.key] = val;
                        }
                      },
                    ),
                  );
                }).toList(),
              ),
            ),
            SafeArea(
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    widget.onApply(_filters, _orderBy);
                    Navigator.of(context).pop();
                  },
                  child: const Text('Apply'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBooleanFilter(FieldConfig field) {
    final value = _filters[field.key];
    return Padding(
      padding: const EdgeInsets.only(bottom: Spacing.md),
      child: DropdownButtonFormField<String>(
        initialValue: value,
        decoration: InputDecoration(labelText: field.label),
        items: const [
          DropdownMenuItem(value: 'true', child: Text('Yes')),
          DropdownMenuItem(value: 'false', child: Text('No')),
        ],
        onChanged: (val) {
          setState(() {
            if (val == null) {
              _filters.remove(field.key);
            } else {
              _filters[field.key] = val;
            }
          });
        },
      ),
    );
  }

  Widget _buildSelectFilter(FieldConfig field) {
    final value = _filters[field.key];
    return Padding(
      padding: const EdgeInsets.only(bottom: Spacing.md),
      child: DropdownButtonFormField<String>(
        initialValue: value,
        decoration: InputDecoration(labelText: field.label),
        items: field.options!
            .map((opt) => DropdownMenuItem(value: opt, child: Text(opt)))
            .toList(),
        onChanged: (val) {
          setState(() {
            if (val == null) {
              _filters.remove(field.key);
            } else {
              _filters[field.key] = val;
            }
          });
        },
      ),
    );
  }
}
