import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:projx_mobile/core/network/api_client.dart';
import 'package:projx_mobile/entities/base/base_repository.dart';
import 'package:projx_mobile/entities/base/base_service.dart';

class MockBaseRepository extends Mock implements BaseRepository {}

void main() {
  late MockBaseRepository repo;
  late BaseService service;

  setUp(() {
    repo = MockBaseRepository();
    service = BaseService(repository: repo);
  });

  test('list delegates to repository.list', () async {
    const paginated = PaginatedResult<Map<String, dynamic>>(
      data: [],
      pagination: PaginationInfo(
        currentPage: 1,
        pageSize: 20,
        totalPages: 0,
        totalRecords: 0,
      ),
    );
    when(() => repo.list(
          page: any(named: 'page'),
          pageSize: any(named: 'pageSize'),
          search: any(named: 'search'),
          orderBy: any(named: 'orderBy'),
          filters: any(named: 'filters'),
          expand: any(named: 'expand'),
        )).thenAnswer((_) async => paginated);

    final res = await service.list(page: 2, pageSize: 5);
    expect(res, same(paginated));
    verify(() => repo.list(
          page: 2,
          pageSize: 5,
          search: null,
          orderBy: null,
          filters: null,
          expand: null,
        )).called(1);
  });

  test('getById delegates to repository.getById', () async {
    when(() => repo.getById('1', expand: any(named: 'expand')))
        .thenAnswer((_) async => {'id': '1'});
    expect(await service.getById('1'), {'id': '1'});
  });

  test('create delegates to repository.create', () async {
    when(() => repo.create({'name': 'A'}))
        .thenAnswer((_) async => {'id': '1', 'name': 'A'});
    expect((await service.create({'name': 'A'}))['name'], 'A');
  });

  test('update delegates to repository.update', () async {
    when(() => repo.update('1', {'name': 'B'}))
        .thenAnswer((_) async => {'id': '1', 'name': 'B'});
    expect((await service.update('1', {'name': 'B'}))['name'], 'B');
  });

  test('delete delegates to repository.delete', () async {
    when(() => repo.delete('1')).thenAnswer((_) async {});
    await expectLater(service.delete('1'), completes);
    verify(() => repo.delete('1')).called(1);
  });
}
