import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:projx_mobile/core/errors/app_exception.dart';
import 'package:projx_mobile/core/network/api_client.dart';
import 'package:projx_mobile/entities/base/base_repository.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockApiClient;
  late BaseRepository repository;

  setUp(() {
    mockApiClient = MockApiClient();
    repository = BaseRepository(
      apiClient: mockApiClient,
      entitySlug: 'test-items',
    );
  });

  group('BaseRepository.list', () {
    test('delegates to ApiClient.list', () async {
      const result = PaginatedResult<Map<String, dynamic>>(
        data: [
          {'id': 1, 'name': 'Widget'},
        ],
        pagination: PaginationInfo(
          currentPage: 1,
          pageSize: 20,
          totalPages: 1,
          totalRecords: 1,
        ),
      );

      when(
        () => mockApiClient.list(
          'test-items',
          page: 1,
          pageSize: 20,
          search: null,
          orderBy: null,
          filters: null,
          expand: null,
        ),
      ).thenAnswer((_) async => result);

      final actual = await repository.list();
      expect(actual.data, hasLength(1));
      expect(actual.data.first['name'], 'Widget');
    });

    test('passes search and orderBy params', () async {
      const result = PaginatedResult<Map<String, dynamic>>(
        data: [],
        pagination: PaginationInfo(
          currentPage: 1,
          pageSize: 10,
          totalPages: 0,
          totalRecords: 0,
        ),
      );

      when(
        () => mockApiClient.list(
          'test-items',
          page: 1,
          pageSize: 10,
          search: 'test',
          orderBy: '-name',
          filters: null,
          expand: null,
        ),
      ).thenAnswer((_) async => result);

      final actual = await repository.list(
        pageSize: 10,
        search: 'test',
        orderBy: '-name',
      );
      expect(actual.data, isEmpty);
    });

    test('rethrows on error without Isar', () async {
      when(
        () => mockApiClient.list(
          'test-items',
          page: any(named: 'page'),
          pageSize: any(named: 'pageSize'),
          search: any(named: 'search'),
          orderBy: any(named: 'orderBy'),
          filters: any(named: 'filters'),
          expand: any(named: 'expand'),
        ),
      ).thenThrow(const ServerException());

      expect(() => repository.list(), throwsA(isA<ServerException>()));
    });
  });

  group('BaseRepository.getById', () {
    test('delegates to ApiClient.getById', () async {
      when(
        () => mockApiClient.getById('test-items', '1', expand: null),
      ).thenAnswer((_) async => {'id': 1, 'name': 'Widget'});

      final result = await repository.getById('1');
      expect(result['name'], 'Widget');
    });

    test('passes expand parameter', () async {
      when(
        () => mockApiClient.getById('test-items', '1', expand: ['category']),
      ).thenAnswer(
        (_) async => {
          'id': 1,
          'name': 'Widget',
          'category': {'id': 1, 'name': 'Tools'},
        },
      );

      final result = await repository.getById('1', expand: ['category']);
      expect(result['category'], isA<Map>());
    });

    test('rethrows on error without Isar', () async {
      when(
        () => mockApiClient.getById('test-items', '99', expand: null),
      ).thenThrow(const NotFoundException());

      expect(() => repository.getById('99'), throwsA(isA<NotFoundException>()));
    });
  });

  group('BaseRepository.create', () {
    test('delegates to ApiClient.create', () async {
      final data = {'name': 'New Widget', 'price': 9.99};
      when(
        () => mockApiClient.create('test-items', data),
      ).thenAnswer((_) async => {'id': 2, ...data});

      final result = await repository.create(data);
      expect(result['id'], 2);
      expect(result['name'], 'New Widget');
    });

    test('rethrows on validation error without Isar', () async {
      when(
        () => mockApiClient.create('test-items', any()),
      ).thenThrow(const ValidationException(message: 'Name required'));

      expect(
        () => repository.create({'price': 9.99}),
        throwsA(isA<ValidationException>()),
      );
    });
  });

  group('BaseRepository.update', () {
    test('delegates to ApiClient.update', () async {
      final data = {'name': 'Updated Widget'};
      when(
        () => mockApiClient.update('test-items', '1', data),
      ).thenAnswer((_) async => {'id': 1, ...data});

      final result = await repository.update('1', data);
      expect(result['name'], 'Updated Widget');
    });
  });

  group('BaseRepository.delete', () {
    test('delegates to ApiClient.delete', () async {
      when(
        () => mockApiClient.delete('test-items', '1'),
      ).thenAnswer((_) async {});

      await repository.delete('1');
      verify(() => mockApiClient.delete('test-items', '1')).called(1);
    });

    test('rethrows on not found error without Isar', () async {
      when(
        () => mockApiClient.delete('test-items', '99'),
      ).thenThrow(const NotFoundException());

      expect(() => repository.delete('99'), throwsA(isA<NotFoundException>()));
    });
  });
}
