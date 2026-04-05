import 'dart:convert';

import 'package:isar/isar.dart';
import 'package:projx_mobile/core/network/api_client.dart';
import 'package:projx_mobile/entities/base/offline/cached_entity.dart';
import 'package:projx_mobile/entities/base/offline/pending_mutation.dart';

class BaseRepository {
  final ApiClient _apiClient;
  final Isar? _isar;
  final String entitySlug;

  BaseRepository({
    required ApiClient apiClient,
    required this.entitySlug,
    Isar? isar,
  })  : _apiClient = apiClient,
        _isar = isar;

  Future<PaginatedResult<Map<String, dynamic>>> list({
    int page = 1,
    int pageSize = 20,
    String? search,
    String? orderBy,
    Map<String, String>? filters,
    List<String>? expand,
  }) async {
    try {
      final result = await _apiClient.list(
        entitySlug,
        page: page,
        pageSize: pageSize,
        search: search,
        orderBy: orderBy,
        filters: filters,
        expand: expand,
      );
      if (_isar != null) {
        await _cacheListResult(result.data);
      }
      return result;
    } catch (_) {
      if (_isar != null) {
        return _getListFromCache(page, pageSize);
      }
      rethrow;
    }
  }

  Future<Map<String, dynamic>> getById(
    String id, {
    List<String>? expand,
  }) async {
    try {
      final result = await _apiClient.getById(entitySlug, id, expand: expand);
      if (_isar != null) {
        await _cacheSingleEntity(id, result);
      }
      return result;
    } catch (_) {
      if (_isar != null) {
        final cached = await _getFromCache(id);
        if (cached != null) return cached;
      }
      rethrow;
    }
  }

  Future<Map<String, dynamic>> create(Map<String, dynamic> data) async {
    try {
      final result = await _apiClient.create(entitySlug, data);
      if (_isar != null) {
        final id = result['id']?.toString();
        if (id != null) await _cacheSingleEntity(id, result);
      }
      return result;
    } catch (_) {
      if (_isar != null) {
        await _queueMutation('POST', null, data);
      }
      rethrow;
    }
  }

  Future<Map<String, dynamic>> update(
    String id,
    Map<String, dynamic> data,
  ) async {
    try {
      final result = await _apiClient.update(entitySlug, id, data);
      if (_isar != null) {
        await _cacheSingleEntity(id, result);
      }
      return result;
    } catch (_) {
      if (_isar != null) {
        await _queueMutation('PATCH', id, data);
      }
      rethrow;
    }
  }

  Future<void> delete(String id) async {
    try {
      await _apiClient.delete(entitySlug, id);
      if (_isar != null) {
        await _removeFromCache(id);
      }
    } catch (_) {
      if (_isar != null) {
        await _queueMutation('DELETE', id, {});
      }
      rethrow;
    }
  }

  Future<void> _cacheListResult(List<Map<String, dynamic>> items) async {
    if (_isar == null) return;
    await _isar.writeTxn(() async {
      for (final item in items) {
        final id = item['id']?.toString();
        if (id == null) continue;
        final existing = await _isar.cachedEntitys
            .filter()
            .entitySlugEqualTo(entitySlug)
            .remoteIdEqualTo(id)
            .findFirst();
        final cached = CachedEntity()
          ..entitySlug = entitySlug
          ..remoteId = id
          ..jsonData = jsonEncode(item)
          ..cachedAt = DateTime.now()
          ..syncedAt = DateTime.now();
        if (existing != null) cached.id = existing.id;
        await _isar.cachedEntitys.put(cached);
      }
    });
  }

  Future<void> _cacheSingleEntity(String id, Map<String, dynamic> data) async {
    if (_isar == null) return;
    await _isar.writeTxn(() async {
      final existing = await _isar.cachedEntitys
          .filter()
          .entitySlugEqualTo(entitySlug)
          .remoteIdEqualTo(id)
          .findFirst();
      final cached = CachedEntity()
        ..entitySlug = entitySlug
        ..remoteId = id
        ..jsonData = jsonEncode(data)
        ..cachedAt = DateTime.now()
        ..syncedAt = DateTime.now();
      if (existing != null) cached.id = existing.id;
      await _isar.cachedEntitys.put(cached);
    });
  }

  Future<Map<String, dynamic>?> _getFromCache(String id) async {
    if (_isar == null) return null;
    final cached = await _isar.cachedEntitys
        .filter()
        .entitySlugEqualTo(entitySlug)
        .remoteIdEqualTo(id)
        .findFirst();
    if (cached == null) return null;
    return jsonDecode(cached.jsonData) as Map<String, dynamic>;
  }

  Future<PaginatedResult<Map<String, dynamic>>> _getListFromCache(
    int page,
    int pageSize,
  ) async {
    if (_isar == null) {
      return const PaginatedResult(
        data: [],
        pagination: PaginationInfo(
          currentPage: 1,
          pageSize: 20,
          totalPages: 0,
          totalRecords: 0,
        ),
      );
    }
    final total = await _isar.cachedEntitys
        .filter()
        .entitySlugEqualTo(entitySlug)
        .count();
    final offset = (page - 1) * pageSize;
    final items = await _isar.cachedEntitys
        .filter()
        .entitySlugEqualTo(entitySlug)
        .sortByCachedAtDesc()
        .offset(offset)
        .limit(pageSize)
        .findAll();
    final data = items
        .map((e) => jsonDecode(e.jsonData) as Map<String, dynamic>)
        .toList();
    return PaginatedResult(
      data: data,
      pagination: PaginationInfo(
        currentPage: page,
        pageSize: pageSize,
        totalPages: (total / pageSize).ceil(),
        totalRecords: total,
      ),
    );
  }

  Future<void> _removeFromCache(String id) async {
    if (_isar == null) return;
    await _isar.writeTxn(() async {
      final items = await _isar.cachedEntitys
          .filter()
          .entitySlugEqualTo(entitySlug)
          .remoteIdEqualTo(id)
          .findAll();
      await _isar.cachedEntitys.deleteAll(items.map((e) => e.id).toList());
    });
  }

  Future<void> _queueMutation(
    String method,
    String? remoteId,
    Map<String, dynamic> data,
  ) async {
    if (_isar == null) return;
    await _isar.writeTxn(() async {
      final mutation = PendingMutation()
        ..entitySlug = entitySlug
        ..method = method
        ..remoteId = remoteId
        ..jsonData = jsonEncode(data)
        ..createdAt = DateTime.now()
        ..retryCount = 0;
      await _isar.pendingMutations.put(mutation);
    });
  }
}
