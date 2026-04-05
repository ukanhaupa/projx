import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:projx_mobile/core/network/api_client.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';
import 'package:projx_mobile/entities/base/base_repository.dart';
import 'package:projx_mobile/entities/base/base_service.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/entities/base/meta_parser.dart';
import 'package:projx_mobile/entities/entity_registry.dart';

final entityConfigsProvider = FutureProvider<List<EntityConfig>>((ref) async {
  final client = ref.watch(apiClientProvider);
  final metaJson = await client.fetchMeta();
  final configs = MetaParser.parse(metaJson);
  ref.read(entityRegistryProvider.notifier).registerAll(configs);
  return configs;
});

final entityConfigProvider = Provider.family<EntityConfig?, String>((
  ref,
  slug,
) {
  final registry = ref.watch(entityRegistryProvider);
  return registry[slug];
});

final entityRepositoryProvider = Provider.family<BaseRepository, String>((
  ref,
  slug,
) {
  final apiClient = ref.watch(apiClientProvider);
  final isar = ref.watch(isarProvider);
  return BaseRepository(apiClient: apiClient, entitySlug: slug, isar: isar);
});

final entityServiceProvider = Provider.family<BaseService, String>((ref, slug) {
  final repository = ref.watch(entityRepositoryProvider(slug));
  return BaseService(repository: repository);
});

final entityListProvider = FutureProvider.family<
    PaginatedResult<Map<String, dynamic>>,
    EntityListParams>((ref, params) async {
  final service = ref.watch(entityServiceProvider(params.slug));
  return service.list(
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    orderBy: params.orderBy,
    filters: params.filters,
    expand: params.expand,
  );
});

final entityDetailProvider =
    FutureProvider.family<Map<String, dynamic>, EntityDetailParams>((
  ref,
  params,
) async {
  final service = ref.watch(entityServiceProvider(params.slug));
  return service.getById(params.id, expand: params.expand);
});

class EntityListParams {
  final String slug;
  final int page;
  final int pageSize;
  final String? search;
  final String? orderBy;
  final Map<String, String>? filters;
  final List<String>? expand;

  const EntityListParams({
    required this.slug,
    this.page = 1,
    this.pageSize = 20,
    this.search,
    this.orderBy,
    this.filters,
    this.expand,
  });

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is EntityListParams &&
          runtimeType == other.runtimeType &&
          slug == other.slug &&
          page == other.page &&
          pageSize == other.pageSize &&
          search == other.search &&
          orderBy == other.orderBy;

  @override
  int get hashCode =>
      slug.hashCode ^
      page.hashCode ^
      pageSize.hashCode ^
      search.hashCode ^
      orderBy.hashCode;
}

class EntityDetailParams {
  final String slug;
  final String id;
  final List<String>? expand;

  const EntityDetailParams({required this.slug, required this.id, this.expand});

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is EntityDetailParams &&
          runtimeType == other.runtimeType &&
          slug == other.slug &&
          id == other.id;

  @override
  int get hashCode => slug.hashCode ^ id.hashCode;
}
