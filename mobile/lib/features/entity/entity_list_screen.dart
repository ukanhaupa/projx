import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:projx_mobile/core/routing/routes.dart';
import 'package:projx_mobile/core/theme/spacing.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/entities/base/entity_providers.dart';
import 'package:projx_mobile/entities/entity_overrides.dart';
import 'package:projx_mobile/features/entity/widgets/entity_filter_sheet.dart';
import 'package:projx_mobile/features/entity/widgets/entity_list_tile.dart';
import 'package:projx_mobile/features/entity/widgets/entity_search_bar.dart';
import 'package:projx_mobile/shared/widgets/confirm_dialog.dart';
import 'package:projx_mobile/shared/widgets/empty_state.dart';
import 'package:projx_mobile/shared/widgets/error_state.dart';
import 'package:projx_mobile/shared/widgets/loading_indicator.dart';
import 'package:projx_mobile/shared/widgets/toast.dart';

class EntityListScreen extends ConsumerStatefulWidget {
  final String slug;

  const EntityListScreen({super.key, required this.slug});

  @override
  ConsumerState<EntityListScreen> createState() => _EntityListScreenState();
}

class _EntityListScreenState extends ConsumerState<EntityListScreen> {
  final ScrollController _scrollController = ScrollController();
  String? _search;
  String? _orderBy;
  Map<String, String> _filters = {};
  int _currentPage = 1;
  final List<Map<String, dynamic>> _items = [];
  bool _hasMore = true;
  bool _isLoadingMore = false;
  Timer? _searchDebounce;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _searchDebounce?.cancel();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
            _scrollController.position.maxScrollExtent - 200 &&
        _hasMore &&
        !_isLoadingMore) {
      _loadMore();
    }
  }

  void _loadMore() {
    setState(() {
      _currentPage++;
      _isLoadingMore = true;
    });
  }

  void _onSearchChanged(String query) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 400), () {
      setState(() {
        _search = query.isEmpty ? null : query;
        _resetPagination();
      });
    });
  }

  void _onSortChanged(String? orderBy) {
    setState(() {
      _orderBy = orderBy;
      _resetPagination();
    });
  }

  void _onFiltersChanged(Map<String, String> filters) {
    setState(() {
      _filters = filters;
      _resetPagination();
    });
  }

  void _resetPagination() {
    _currentPage = 1;
    _items.clear();
    _hasMore = true;
    _isLoadingMore = false;
  }

  Future<void> _handleDelete(String id) async {
    final confirmed = await ConfirmDialog.show(
      context,
      title: 'Delete item?',
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      variant: ConfirmDialogVariant.danger,
    );

    if (!confirmed || !mounted) return;

    try {
      final service = ref.read(entityServiceProvider(widget.slug));
      await service.delete(id);
      if (!mounted) return;
      AppToast.show(context, message: 'Item deleted', type: ToastType.success);
      setState(() => _resetPagination());
    } catch (e) {
      if (!mounted) return;
      AppToast.show(
        context,
        message: 'Failed to delete item',
        type: ToastType.error,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final config = ref.watch(entityConfigProvider(widget.slug));
    final override = EntityOverrides.get(widget.slug);

    final params = EntityListParams(
      slug: widget.slug,
      page: _currentPage,
      search: _search,
      orderBy: _orderBy ?? override?.defaultOrderBy,
      filters: _filters.isNotEmpty ? _filters : null,
      expand: override?.listExpandFields,
      pageSize: override?.pageSize ?? 20,
    );

    final listData = ref.watch(entityListProvider(params));

    return Scaffold(
      appBar: AppBar(
        title: Text(config?.namePlural ?? widget.slug),
        leading: Builder(
          builder: (context) => IconButton(
            icon: const Icon(Icons.menu),
            onPressed: () => Scaffold.of(context).openDrawer(),
          ),
        ),
        actions: [
          if (config != null)
            IconButton(
              icon: const Icon(Icons.filter_list),
              onPressed: () => _showFilterSheet(context, config),
            ),
        ],
      ),
      body: Column(
        children: [
          EntitySearchBar(onChanged: _onSearchChanged),
          if (_orderBy != null || _filters.isNotEmpty)
            _buildActiveFilters(context),
          Expanded(
            child: listData.when(
              data: (result) {
                if (_currentPage == 1) {
                  _items.clear();
                }
                final newItems = result.data.where((item) {
                  final id = item['id']?.toString();
                  return !_items.any(
                    (existing) => existing['id']?.toString() == id,
                  );
                }).toList();
                _items.addAll(newItems);
                _hasMore = result.pagination.hasNextPage;
                _isLoadingMore = false;

                if (_items.isEmpty) {
                  return EmptyState(
                    title: 'No items yet',
                    description: 'Tap the + button to create your first item.',
                    actionLabel: 'Create',
                    onAction: () =>
                        context.go(Routes.entityCreate(widget.slug)),
                  );
                }

                return RefreshIndicator(
                  onRefresh: () async {
                    setState(() => _resetPagination());
                    ref.invalidate(entityListProvider(params));
                  },
                  child: ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(vertical: Spacing.sm),
                    itemCount: _items.length + (_hasMore ? 1 : 0),
                    itemBuilder: (context, index) {
                      if (index >= _items.length) {
                        return const Padding(
                          padding: EdgeInsets.all(Spacing.md),
                          child: Center(child: CircularProgressIndicator()),
                        );
                      }
                      final item = _items[index];
                      return EntityListTile(
                        config: config!,
                        item: item,
                        entityOverride: override,
                        onTap: () => context.go(
                          Routes.entityDetail(
                            widget.slug,
                            item['id'].toString(),
                          ),
                        ),
                        onEdit: () => context.go(
                          Routes.entityEdit(widget.slug, item['id'].toString()),
                        ),
                        onDelete: () => _handleDelete(item['id'].toString()),
                      );
                    },
                  ),
                );
              },
              loading: () => _items.isEmpty
                  ? const ShimmerList()
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.symmetric(vertical: Spacing.sm),
                      itemCount: _items.length + 1,
                      itemBuilder: (context, index) {
                        if (index >= _items.length) {
                          return const Padding(
                            padding: EdgeInsets.all(Spacing.md),
                            child: Center(child: CircularProgressIndicator()),
                          );
                        }
                        return EntityListTile(
                          config: config!,
                          item: _items[index],
                          entityOverride: override,
                          onTap: () {},
                          onEdit: () {},
                          onDelete: () {},
                        );
                      },
                    ),
              error: (error, _) => ErrorState(
                error: error,
                onRetry: () {
                  setState(() => _resetPagination());
                  ref.invalidate(entityListProvider(params));
                },
              ),
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.go(Routes.entityCreate(widget.slug)),
        tooltip: 'Create',
        child: const Icon(Icons.add),
      ),
    );
  }

  Widget _buildActiveFilters(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Spacing.md),
      child: Wrap(
        spacing: Spacing.xs,
        children: [
          if (_orderBy != null)
            Chip(
              label: Text('Sort: $_orderBy', style: theme.textTheme.bodySmall),
              onDeleted: () => _onSortChanged(null),
              visualDensity: VisualDensity.compact,
            ),
          ..._filters.entries.map(
            (entry) => Chip(
              label: Text(
                '${entry.key}: ${entry.value}',
                style: theme.textTheme.bodySmall,
              ),
              onDeleted: () {
                final newFilters = Map<String, String>.from(_filters)
                  ..remove(entry.key);
                _onFiltersChanged(newFilters);
              },
              visualDensity: VisualDensity.compact,
            ),
          ),
        ],
      ),
    );
  }

  void _showFilterSheet(BuildContext context, EntityConfig config) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => EntityFilterSheet(
        config: config,
        currentFilters: _filters,
        currentOrderBy: _orderBy,
        onApply: (filters, orderBy) {
          _onFiltersChanged(filters);
          _onSortChanged(orderBy);
        },
      ),
    );
  }
}
