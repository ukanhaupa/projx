import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:projx_mobile/core/errors/app_exception.dart';
import 'package:projx_mobile/core/network/api_client.dart';

class MockDio extends Mock implements Dio {}

void main() {
  late MockDio dio;
  late ApiClient client;

  setUp(() {
    dio = MockDio();
    client = ApiClient(dio: dio);
  });

  Response<dynamic> buildResponse(dynamic data, {int statusCode = 200}) {
    return Response(
      requestOptions: RequestOptions(path: ''),
      data: data,
      statusCode: statusCode,
    );
  }

  DioException buildDioError(int statusCode, {dynamic data}) {
    return DioException(
      requestOptions: RequestOptions(path: ''),
      response: Response(
        requestOptions: RequestOptions(path: ''),
        statusCode: statusCode,
        data: data,
      ),
    );
  }

  group('list', () {
    test('returns PaginatedResult with data', () async {
      when(
        () => dio.get(
          '/api/v1/products/',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer(
        (_) async => buildResponse({
          'data': [
            {'id': '1', 'name': 'A'},
            {'id': '2', 'name': 'B'},
          ],
          'pagination': {
            'current_page': 1,
            'page_size': 20,
            'total_pages': 1,
            'total_records': 2,
          },
        }),
      );

      final result = await client.list('products');

      expect(result.data, hasLength(2));
      expect(result.pagination.totalRecords, 2);
    });

    test('passes query params correctly', () async {
      when(
        () => dio.get(
          '/api/v1/products/',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer(
        (_) async => buildResponse({
          'data': [],
          'pagination': {
            'current_page': 2,
            'page_size': 10,
            'total_pages': 5,
            'total_records': 50,
          },
        }),
      );

      await client.list(
        'products',
        page: 2,
        pageSize: 10,
        search: 'widget',
        orderBy: '-created_at',
        filters: {'status': 'active'},
        expand: ['category', 'brand'],
      );

      verify(
        () => dio.get(
          '/api/v1/products/',
          queryParameters: {
            'page': 2,
            'page_size': 10,
            'search': 'widget',
            'order_by': '-created_at',
            'expand': 'category,brand',
            'status': 'active',
          },
        ),
      ).called(1);
    });
  });

  group('getById', () {
    test('returns entity map', () async {
      when(
        () => dio.get(
          '/api/v1/products/abc',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer((_) async => buildResponse({'id': 'abc', 'name': 'Widget'}));

      final result = await client.getById('products', 'abc');

      expect(result['id'], 'abc');
      expect(result['name'], 'Widget');
    });

    test('passes expand param', () async {
      when(
        () => dio.get(
          '/api/v1/products/abc',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer((_) async => buildResponse({'id': 'abc'}));

      await client.getById('products', 'abc', expand: ['category']);

      verify(
        () => dio.get(
          '/api/v1/products/abc',
          queryParameters: {'expand': 'category'},
        ),
      ).called(1);
    });
  });

  group('create', () {
    test('sends POST and returns response', () async {
      when(
        () => dio.post('/api/v1/products/', data: any(named: 'data')),
      ).thenAnswer(
          (_) async => buildResponse({'id': 'new', 'name': 'Created'}));

      final result = await client.create('products', {'name': 'Created'});

      expect(result['id'], 'new');
      verify(
        () => dio.post('/api/v1/products/', data: {'name': 'Created'}),
      ).called(1);
    });
  });

  group('update', () {
    test('sends PATCH and returns response', () async {
      when(
        () => dio.patch('/api/v1/products/abc', data: any(named: 'data')),
      ).thenAnswer(
          (_) async => buildResponse({'id': 'abc', 'name': 'Updated'}));

      final result = await client.update('products', 'abc', {
        'name': 'Updated',
      });

      expect(result['name'], 'Updated');
      verify(
        () => dio.patch('/api/v1/products/abc', data: {'name': 'Updated'}),
      ).called(1);
    });
  });

  group('delete', () {
    test('sends DELETE', () async {
      when(
        () => dio.delete('/api/v1/products/abc'),
      ).thenAnswer((_) async => buildResponse(null, statusCode: 204));

      await client.delete('products', 'abc');

      verify(() => dio.delete('/api/v1/products/abc')).called(1);
    });
  });

  group('bulkCreate', () {
    test('sends POST to bulk endpoint', () async {
      final items = [
        {'name': 'A'},
        {'name': 'B'},
      ];
      when(
        () => dio.post('/api/v1/products/bulk', data: any(named: 'data')),
      ).thenAnswer(
        (_) async => buildResponse([
          {'id': '1', 'name': 'A'},
          {'id': '2', 'name': 'B'},
        ]),
      );

      final result = await client.bulkCreate('products', items);

      expect(result, hasLength(2));
      verify(() => dio.post('/api/v1/products/bulk', data: items)).called(1);
    });
  });

  group('bulkDelete', () {
    test('sends DELETE to bulk endpoint', () async {
      when(
        () => dio.delete('/api/v1/products/bulk', data: any(named: 'data')),
      ).thenAnswer((_) async => buildResponse(null, statusCode: 204));

      await client.bulkDelete('products', ['1', '2']);

      verify(
        () => dio.delete(
          '/api/v1/products/bulk',
          data: {
            'ids': ['1', '2'],
          },
        ),
      ).called(1);
    });
  });

  group('fetchMeta', () {
    test('returns list of entity configs', () async {
      when(() => dio.get('/api/v1/_meta')).thenAnswer(
        (_) async => buildResponse([
          {'slug': 'products', 'label': 'Products'},
          {'slug': 'orders', 'label': 'Orders'},
        ]),
      );

      final result = await client.fetchMeta();

      expect(result, hasLength(2));
      expect(result[0]['slug'], 'products');
    });
  });

  group('healthCheck', () {
    test('returns true on 200', () async {
      when(
        () => dio.get('/api/health'),
      ).thenAnswer((_) async => buildResponse({'status': 'ok'}));

      final result = await client.healthCheck();

      expect(result, isTrue);
    });

    test('returns false on error', () async {
      when(() => dio.get('/api/health')).thenThrow(
        DioException(requestOptions: RequestOptions(path: '/api/health')),
      );

      final result = await client.healthCheck();

      expect(result, isFalse);
    });
  });

  group('error handling', () {
    test('DioException 404 throws NotFoundException', () async {
      when(
        () => dio.get(
          '/api/v1/products/missing',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenThrow(buildDioError(404));

      expect(
        () => client.getById('products', 'missing'),
        throwsA(isA<NotFoundException>()),
      );
    });

    test('DioException 401 throws UnauthorizedException', () async {
      when(
        () => dio.get(
          '/api/v1/products/',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenThrow(buildDioError(401));

      expect(
        () => client.list('products'),
        throwsA(isA<UnauthorizedException>()),
      );
    });
  });
}
