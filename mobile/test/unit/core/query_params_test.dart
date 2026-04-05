import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/entities/base/query_params.dart';

void main() {
  group('QueryParams.build', () {
    test('includes page and page_size by default', () {
      final params = QueryParams.build();
      expect(params['page'], 1);
      expect(params['page_size'], 20);
    });

    test('includes search when provided', () {
      final params = QueryParams.build(search: 'hello');
      expect(params['search'], 'hello');
    });

    test('excludes search when empty', () {
      final params = QueryParams.build(search: '');
      expect(params.containsKey('search'), false);
    });

    test('includes order_by when provided', () {
      final params = QueryParams.build(orderBy: '-created_at');
      expect(params['order_by'], '-created_at');
    });

    test('joins expand list with commas', () {
      final params = QueryParams.build(expand: ['author', 'category']);
      expect(params['expand'], 'author,category');
    });

    test('merges filters into params', () {
      final params = QueryParams.build(
        filters: {'status': 'active', 'role': 'admin'},
      );
      expect(params['status'], 'active');
      expect(params['role'], 'admin');
    });

    test('excludes empty filter values', () {
      final params = QueryParams.build(
        filters: {'status': 'active', 'role': ''},
      );
      expect(params['status'], 'active');
      expect(params.containsKey('role'), false);
    });

    test('custom page and page_size', () {
      final params = QueryParams.build(page: 3, pageSize: 50);
      expect(params['page'], 3);
      expect(params['page_size'], 50);
    });
  });
}
