import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/shared/extensions/string_extensions.dart';

void main() {
  group('StringExtensions', () {
    group('capitalize', () {
      test('capitalizes first letter', () {
        expect('hello'.capitalize(), 'Hello');
      });

      test('handles empty string', () {
        expect(''.capitalize(), '');
      });

      test('handles single character', () {
        expect('a'.capitalize(), 'A');
      });
    });

    group('truncate', () {
      test('truncates long strings', () {
        expect('Hello World'.truncate(8), 'Hello...');
      });

      test('does not truncate short strings', () {
        expect('Hi'.truncate(8), 'Hi');
      });

      test('supports custom suffix', () {
        expect('Hello World'.truncate(8, suffix: '..'), 'Hello ..');
      });
    });

    group('toTitleCase', () {
      test('converts snake_case to Title Case', () {
        expect('hello_world'.toTitleCase(), 'Hello World');
      });

      test('handles spaces', () {
        expect('hello world'.toTitleCase(), 'Hello World');
      });

      test('handles hyphens', () {
        expect('hello-world'.toTitleCase(), 'Hello World');
      });
    });

    group('pluralize', () {
      test('adds s by default', () {
        expect('item'.pluralize(), 'items');
      });

      test('handles words ending in y', () {
        expect('category'.pluralize(), 'categories');
      });

      test('handles words ending in s', () {
        expect('status'.pluralize(), 'statuses');
      });

      test('returns singular for count 1', () {
        expect('item'.pluralize(count: 1), 'item');
      });
    });
  });
}
