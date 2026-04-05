import 'package:dio/dio.dart';
import 'package:projx_mobile/core/config/constants.dart';
import 'package:projx_mobile/core/errors/error_handler.dart';
import 'package:projx_mobile/entities/base/query_params.dart';

class PaginatedResult<T> {
  final List<T> data;
  final PaginationInfo pagination;

  const PaginatedResult({required this.data, required this.pagination});

  factory PaginatedResult.fromJson(
    Map<String, dynamic> json, [
    T Function(Map<String, dynamic>)? fromJson,
  ]) {
    final rawData = json['data'] as List;
    final data = fromJson != null
        ? rawData.map((e) => fromJson(e as Map<String, dynamic>)).toList()
        : rawData.cast<T>();

    return PaginatedResult(
      data: data,
      pagination: PaginationInfo.fromJson(
        json['pagination'] as Map<String, dynamic>,
      ),
    );
  }
}

class PaginationInfo {
  final int currentPage;
  final int pageSize;
  final int totalPages;
  final int totalRecords;

  const PaginationInfo({
    required this.currentPage,
    required this.pageSize,
    required this.totalPages,
    required this.totalRecords,
  });

  factory PaginationInfo.fromJson(Map<String, dynamic> json) {
    return PaginationInfo(
      currentPage: json['current_page'] as int,
      pageSize: json['page_size'] as int,
      totalPages: json['total_pages'] as int,
      totalRecords: json['total_records'] as int,
    );
  }

  bool get hasNextPage => currentPage < totalPages;
  bool get hasPreviousPage => currentPage > 1;
}

class ApiClient {
  final Dio _dio;

  ApiClient({required Dio dio}) : _dio = dio;

  Future<PaginatedResult<Map<String, dynamic>>> list(
    String entitySlug, {
    int page = 1,
    int pageSize = Pagination.defaultPageSize,
    String? search,
    String? orderBy,
    Map<String, String>? filters,
    List<String>? expand,
  }) async {
    try {
      final queryParams = QueryParams.build(
        page: page,
        pageSize: pageSize,
        search: search,
        orderBy: orderBy,
        filters: filters,
        expand: expand,
      );
      final response = await _dio.get(
        ApiPaths.entityBase(entitySlug),
        queryParameters: queryParams,
      );
      return PaginatedResult<Map<String, dynamic>>.fromJson(
        response.data as Map<String, dynamic>,
      );
    } on DioException catch (e) {
      throw ErrorHandler.fromDioException(e);
    }
  }

  Future<Map<String, dynamic>> getById(
    String entitySlug,
    String id, {
    List<String>? expand,
  }) async {
    try {
      final queryParams = <String, dynamic>{};
      if (expand != null && expand.isNotEmpty) {
        queryParams['expand'] = expand.join(',');
      }
      final response = await _dio.get(
        ApiPaths.entityById(entitySlug, id),
        queryParameters: queryParams,
      );
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw ErrorHandler.fromDioException(e);
    }
  }

  Future<Map<String, dynamic>> create(
    String entitySlug,
    Map<String, dynamic> data,
  ) async {
    try {
      final response = await _dio.post(
        ApiPaths.entityBase(entitySlug),
        data: data,
      );
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw ErrorHandler.fromDioException(e);
    }
  }

  Future<Map<String, dynamic>> update(
    String entitySlug,
    String id,
    Map<String, dynamic> data,
  ) async {
    try {
      final response = await _dio.patch(
        ApiPaths.entityById(entitySlug, id),
        data: data,
      );
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw ErrorHandler.fromDioException(e);
    }
  }

  Future<void> delete(String entitySlug, String id) async {
    try {
      await _dio.delete(ApiPaths.entityById(entitySlug, id));
    } on DioException catch (e) {
      throw ErrorHandler.fromDioException(e);
    }
  }

  Future<List<Map<String, dynamic>>> bulkCreate(
    String entitySlug,
    List<Map<String, dynamic>> items,
  ) async {
    try {
      final response = await _dio.post(
        ApiPaths.entityBulk(entitySlug),
        data: items,
      );
      return (response.data as List).cast<Map<String, dynamic>>();
    } on DioException catch (e) {
      throw ErrorHandler.fromDioException(e);
    }
  }

  Future<void> bulkDelete(String entitySlug, List<String> ids) async {
    try {
      await _dio.delete(ApiPaths.entityBulk(entitySlug), data: {'ids': ids});
    } on DioException catch (e) {
      throw ErrorHandler.fromDioException(e);
    }
  }

  Future<List<Map<String, dynamic>>> fetchMeta() async {
    try {
      final response = await _dio.get(ApiPaths.meta);
      return (response.data as List).cast<Map<String, dynamic>>();
    } on DioException catch (e) {
      throw ErrorHandler.fromDioException(e);
    }
  }

  Future<bool> healthCheck() async {
    try {
      final response = await _dio.get(ApiPaths.health);
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }
}
