import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';

void main() {
  group('EntityConfig', () {
    const config = EntityConfig(
      slug: 'users',
      name: 'User',
      namePlural: 'Users',
      fields: [
        FieldConfig(
          key: 'id',
          label: 'ID',
          type: 'int',
          fieldType: FieldType.number,
          isAuto: true,
          isPrimaryKey: true,
        ),
        FieldConfig(
          key: 'name',
          label: 'Name',
          type: 'str',
          fieldType: FieldType.text,
        ),
        FieldConfig(
          key: 'email',
          label: 'Email',
          type: 'str',
          fieldType: FieldType.text,
        ),
        FieldConfig(
          key: 'bio',
          label: 'Bio',
          type: 'str',
          fieldType: FieldType.textarea,
          nullable: true,
          filterable: false,
        ),
        FieldConfig(
          key: 'created_at',
          label: 'Created At',
          type: 'datetime',
          fieldType: FieldType.datetime,
          isAuto: true,
        ),
      ],
    );

    test('formFields excludes auto fields', () {
      final formFields = config.formFields;
      expect(formFields.map((f) => f.key), ['name', 'email', 'bio']);
    });

    test('filterableFields excludes non-filterable', () {
      final filterable = config.filterableFields;
      expect(filterable.any((f) => f.key == 'bio'), false);
    });

    test('primaryField returns name field', () {
      expect(config.primaryField?.key, 'name');
    });

    test('subtitleField returns second non-auto text field', () {
      expect(config.subtitleField?.key, 'email');
    });

    test('listDisplayFields returns up to 4 non-auto fields', () {
      final display = config.listDisplayFields;
      expect(display.length, 3);
      expect(display.map((f) => f.key), ['name', 'email', 'bio']);
    });
  });

  group('FieldConfig', () {
    test('isRequired when not nullable and not auto', () {
      const field = FieldConfig(
        key: 'name',
        label: 'Name',
        type: 'str',
        fieldType: FieldType.text,
      );
      expect(field.isRequired, true);
    });

    test('not required when nullable', () {
      const field = FieldConfig(
        key: 'bio',
        label: 'Bio',
        type: 'str',
        fieldType: FieldType.textarea,
        nullable: true,
      );
      expect(field.isRequired, false);
    });

    test('not required when auto', () {
      const field = FieldConfig(
        key: 'id',
        label: 'ID',
        type: 'int',
        fieldType: FieldType.number,
        isAuto: true,
      );
      expect(field.isRequired, false);
    });
  });

  group('FieldType', () {
    test('fromString maps known types', () {
      expect(FieldType.fromString('text'), FieldType.text);
      expect(FieldType.fromString('number'), FieldType.number);
      expect(FieldType.fromString('date'), FieldType.date);
      expect(FieldType.fromString('datetime'), FieldType.datetime);
      expect(FieldType.fromString('textarea'), FieldType.textarea);
      expect(FieldType.fromString('boolean'), FieldType.boolean);
      expect(FieldType.fromString('select'), FieldType.select);
    });

    test('fromString defaults to text for unknown', () {
      expect(FieldType.fromString('unknown'), FieldType.text);
    });
  });
}
