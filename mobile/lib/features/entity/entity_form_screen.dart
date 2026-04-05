import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:projx_mobile/core/routing/routes.dart';
import 'package:projx_mobile/core/theme/spacing.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/entities/base/entity_providers.dart';
import 'package:projx_mobile/entities/entity_overrides.dart';
import 'package:projx_mobile/features/entity/widgets/entity_field.dart';
import 'package:projx_mobile/shared/widgets/confirm_dialog.dart';
import 'package:projx_mobile/shared/widgets/error_state.dart';
import 'package:projx_mobile/shared/widgets/loading_indicator.dart';
import 'package:projx_mobile/shared/widgets/toast.dart';

class EntityFormScreen extends ConsumerStatefulWidget {
  final String slug;
  final String? id;

  const EntityFormScreen({super.key, required this.slug, this.id});

  bool get isEditing => id != null;

  @override
  ConsumerState<EntityFormScreen> createState() => _EntityFormScreenState();
}

class _EntityFormScreenState extends ConsumerState<EntityFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final Map<String, dynamic> _formData = {};
  bool _isDirty = false;
  bool _isSaving = false;

  @override
  Widget build(BuildContext context) {
    final config = ref.watch(entityConfigProvider(widget.slug));
    final override = EntityOverrides.get(widget.slug);

    if (widget.isEditing) {
      final detailParams = EntityDetailParams(
        slug: widget.slug,
        id: widget.id!,
      );
      final detailData = ref.watch(entityDetailProvider(detailParams));

      return detailData.when(
        data: (item) {
          if (_formData.isEmpty) {
            _formData.addAll(item);
          }
          return _buildForm(context, config, override, item);
        },
        loading: () => Scaffold(
          appBar: AppBar(title: const Text('Loading...')),
          body: const LoadingIndicator(),
        ),
        error: (error, _) => Scaffold(
          appBar: AppBar(),
          body: ErrorState(
            error: error,
            onRetry: () => ref.invalidate(entityDetailProvider(detailParams)),
          ),
        ),
      );
    }

    return _buildForm(context, config, override, null);
  }

  Widget _buildForm(
    BuildContext context,
    EntityConfig? config,
    EntityOverride? override,
    Map<String, dynamic>? initialData,
  ) {
    if (override?.formBuilder != null && config != null) {
      return Scaffold(
        appBar: _buildAppBar(context, config),
        body: override!.formBuilder!(
          context,
          config,
          initialData,
          _handleSubmit,
        ),
      );
    }

    return PopScope(
      canPop: !_isDirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final discard = await ConfirmDialog.show(
          context,
          title: 'Unsaved changes',
          description: 'Discard your changes?',
          confirmLabel: 'Discard',
          variant: ConfirmDialogVariant.danger,
        );
        if (discard && context.mounted) {
          Navigator.of(context).pop();
        }
      },
      child: Scaffold(
        appBar: _buildAppBar(context, config),
        body: Form(
          key: _formKey,
          child: ListView(
            padding: Spacing.pagePadding,
            children: [
              if (config != null)
                ...config.formFields.map(
                  (field) => Padding(
                    padding: Spacing.formFieldPadding,
                    child: EntityField(
                      field: field,
                      value: _formData[field.key] ?? initialData?[field.key],
                      onChanged: (value) {
                        setState(() {
                          _formData[field.key] = value;
                          _isDirty = true;
                        });
                      },
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  PreferredSizeWidget _buildAppBar(BuildContext context, EntityConfig? config) {
    final title = widget.isEditing
        ? 'Edit ${config?.name ?? ''}'
        : 'Create ${config?.name ?? ''}';

    return AppBar(
      title: Text(title),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => _submitForm(),
          child: _isSaving
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Save'),
        ),
      ],
    );
  }

  void _submitForm() {
    if (!_formKey.currentState!.validate()) return;
    _formKey.currentState!.save();
    _handleSubmit(_formData);
  }

  Future<void> _handleSubmit(Map<String, dynamic> data) async {
    setState(() => _isSaving = true);

    try {
      final service = ref.read(entityServiceProvider(widget.slug));

      final cleanData = Map<String, dynamic>.from(data);
      final config = ref.read(entityConfigProvider(widget.slug));
      if (config != null) {
        for (final field in config.fields) {
          if (field.isAuto) cleanData.remove(field.key);
        }
      }

      if (widget.isEditing) {
        await service.update(widget.id!, cleanData);
      } else {
        await service.create(cleanData);
      }

      if (!mounted) return;
      _isDirty = false;
      AppToast.show(
        context,
        message: widget.isEditing ? 'Item updated' : 'Item created',
        type: ToastType.success,
      );
      context.go(Routes.entityList(widget.slug));
    } catch (e) {
      if (!mounted) return;
      AppToast.show(context, message: 'Failed to save', type: ToastType.error);
    } finally {
      if (mounted) {
        setState(() => _isSaving = false);
      }
    }
  }
}
