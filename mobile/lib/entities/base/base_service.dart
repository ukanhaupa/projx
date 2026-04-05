import 'package:projx_mobile/core/network/api_client.dart';
import 'package:projx_mobile/entities/base/base_repository.dart';

class BaseService {
  final BaseRepository _repository;

  BaseService({required BaseRepository repository}) : _repository = repository;

  Future<PaginatedResult<Map<String, dynamic>>> list({
    int page = 1,
    int pageSize = 20,
    String? search,
    String? orderBy,
    Map<String, String>? filters,
    List<String>? expand,
  }) {
    return _repository.list(
      page: page,
      pageSize: pageSize,
      search: search,
      orderBy: orderBy,
      filters: filters,
      expand: expand,
    );
  }

  Future<Map<String, dynamic>> getById(String id, {List<String>? expand}) {
    return _repository.getById(id, expand: expand);
  }

  Future<Map<String, dynamic>> create(Map<String, dynamic> data) {
    return _repository.create(data);
  }

  Future<Map<String, dynamic>> update(String id, Map<String, dynamic> data) {
    return _repository.update(id, data);
  }

  Future<void> delete(String id) {
    return _repository.delete(id);
  }
}
