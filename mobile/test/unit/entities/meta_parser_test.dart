import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/entities/base/meta_parser.dart';

void main() {
  group('MetaParser.parse', () {
    test('parses a basic entity config', () {
      final meta = [
        {
          'slug': 'users',
          'name': 'User',
          'name_plural': 'Users',
          'soft_delete': true,
          'searchable_fields': ['name', 'email'],
          'fields': [
            {
              'key': 'id',
              'label': 'ID',
              'type': 'int',
              'field_type': 'number',
              'nullable': false,
              'is_auto': true,
              'is_primary_key': true,
              'filterable': true,
            },
            {
              'key': 'name',
              'label': 'Name',
              'type': 'str',
              'field_type': 'text',
              'nullable': false,
              'is_auto': false,
              'is_primary_key': false,
              'filterable': true,
              'max_length': 255,
            },
            {
              'key': 'email',
              'label': 'Email',
              'type': 'str',
              'field_type': 'text',
              'nullable': false,
              'is_auto': false,
              'filterable': true,
            },
            {
              'key': 'role_id',
              'label': 'Role',
              'type': 'int',
              'field_type': 'number',
              'nullable': true,
              'is_auto': false,
              'has_foreign_key': true,
              'filterable': true,
            },
          ],
        },
      ];

      final configs = MetaParser.parse(meta);

      expect(configs, hasLength(1));
      final config = configs.first;
      expect(config.slug, 'users');
      expect(config.name, 'User');
      expect(config.namePlural, 'Users');
      expect(config.softDelete, true);
      expect(config.searchableFields, ['name', 'email']);
      expect(config.fields, hasLength(4));
    });

    test('parses field types correctly', () {
      final meta = [
        {
          'slug': 'tasks',
          'fields': [
            {'key': 'title', 'field_type': 'text'},
            {'key': 'count', 'field_type': 'number'},
            {'key': 'due_date', 'field_type': 'date'},
            {'key': 'completed', 'field_type': 'boolean'},
            {'key': 'description', 'field_type': 'textarea'},
            {
              'key': 'status',
              'field_type': 'select',
              'options': ['open', 'closed'],
            },
          ],
        },
      ];

      final configs = MetaParser.parse(meta);
      final fields = configs.first.fields;

      expect(fields[0].fieldType, FieldType.text);
      expect(fields[1].fieldType, FieldType.number);
      expect(fields[2].fieldType, FieldType.date);
      expect(fields[3].fieldType, FieldType.boolean);
      expect(fields[4].fieldType, FieldType.textarea);
      expect(fields[5].fieldType, FieldType.select);
      expect(fields[5].options, ['open', 'closed']);
    });

    test('infers name from slug when not provided', () {
      final meta = [
        {'slug': 'user_roles', 'fields': []},
      ];

      final configs = MetaParser.parse(meta);
      expect(configs.first.name, 'User Roles');
    });

    test('detects foreign key entity from key suffix', () {
      final meta = [
        {
          'slug': 'posts',
          'fields': [
            {
              'key': 'author_id',
              'field_type': 'number',
              'has_foreign_key': true,
            },
          ],
        },
      ];

      final configs = MetaParser.parse(meta);
      expect(configs.first.fields.first.foreignKeyEntity, 'author');
    });

    test('formFields excludes auto fields', () {
      final meta = [
        {
          'slug': 'items',
          'fields': [
            {
              'key': 'id',
              'field_type': 'number',
              'is_auto': true,
              'is_primary_key': true,
            },
            {'key': 'name', 'field_type': 'text', 'is_auto': false},
            {'key': 'created_at', 'field_type': 'datetime', 'is_auto': true},
          ],
        },
      ];

      final configs = MetaParser.parse(meta);
      expect(configs.first.formFields, hasLength(1));
      expect(configs.first.formFields.first.key, 'name');
    });

    test('primaryField finds name field', () {
      final meta = [
        {
          'slug': 'items',
          'fields': [
            {
              'key': 'id',
              'field_type': 'number',
              'is_auto': true,
              'is_primary_key': true,
            },
            {'key': 'name', 'field_type': 'text'},
            {'key': 'email', 'field_type': 'text'},
          ],
        },
      ];

      final configs = MetaParser.parse(meta);
      expect(configs.first.primaryField?.key, 'name');
    });
  });
}
