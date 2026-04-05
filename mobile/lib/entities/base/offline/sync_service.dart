import 'dart:async';
import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:isar/isar.dart';
import 'package:projx_mobile/core/errors/app_exception.dart';
import 'package:projx_mobile/core/network/api_client.dart';
import 'package:projx_mobile/entities/base/offline/pending_mutation.dart';

class SyncService {
  final ApiClient _apiClient;
  final Isar _isar;
  final Connectivity _connectivity;
  static const int _maxRetries = 5;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  bool _isSyncing = false;

  SyncService({
    required ApiClient apiClient,
    required Isar isar,
    Connectivity? connectivity,
  })  : _apiClient = apiClient,
        _isar = isar,
        _connectivity = connectivity ?? Connectivity();

  Future<int> get pendingCount async => _isar.pendingMutations.count();

  void startListening() {
    _connectivitySubscription?.cancel();
    _connectivitySubscription = _connectivity.onConnectivityChanged.listen((
      results,
    ) {
      final isOnline = !results.contains(ConnectivityResult.none);
      if (isOnline) {
        syncAll();
      }
    });
  }

  void stopListening() {
    _connectivitySubscription?.cancel();
    _connectivitySubscription = null;
  }

  Future<SyncResult> syncAll() async {
    if (_isSyncing) return const SyncResult(synced: 0, failed: 0, remaining: 0);
    _isSyncing = true;

    int synced = 0;
    int failed = 0;

    try {
      final mutations =
          await _isar.pendingMutations.where().sortByCreatedAt().findAll();

      for (final mutation in mutations) {
        final success = await _processMutation(mutation);
        if (success) {
          synced++;
        } else {
          failed++;
        }
      }
    } finally {
      _isSyncing = false;
    }

    final remaining = await pendingCount;
    return SyncResult(synced: synced, failed: failed, remaining: remaining);
  }

  Future<bool> _processMutation(PendingMutation mutation) async {
    try {
      final data = jsonDecode(mutation.jsonData) as Map<String, dynamic>;

      switch (mutation.method) {
        case 'POST':
          await _apiClient.create(mutation.entitySlug, data);
        case 'PATCH':
          if (mutation.remoteId != null) {
            await _apiClient.update(
              mutation.entitySlug,
              mutation.remoteId!,
              data,
            );
          }
        case 'DELETE':
          if (mutation.remoteId != null) {
            await _apiClient.delete(mutation.entitySlug, mutation.remoteId!);
          }
      }

      await _isar.writeTxn(() async {
        await _isar.pendingMutations.delete(mutation.id);
      });
      return true;
    } catch (e) {
      if (_isPermanentError(e)) {
        await _isar.writeTxn(() async {
          await _isar.pendingMutations.delete(mutation.id);
        });
        return false;
      }

      if (mutation.retryCount >= _maxRetries) {
        await _isar.writeTxn(() async {
          await _isar.pendingMutations.delete(mutation.id);
        });
        return false;
      }

      await _isar.writeTxn(() async {
        mutation.retryCount++;
        await _isar.pendingMutations.put(mutation);
      });
      return false;
    }
  }

  bool _isPermanentError(Object error) {
    if (error is AppException) {
      return error is ValidationException ||
          error is ForbiddenException ||
          error is NotFoundException ||
          error is ConflictException;
    }
    return false;
  }
}

class SyncResult {
  final int synced;
  final int failed;
  final int remaining;

  const SyncResult({
    required this.synced,
    required this.failed,
    required this.remaining,
  });
}
