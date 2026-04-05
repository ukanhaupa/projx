import 'package:projx_mobile/entities/base/entity_config.dart';

class MetaParser {
  static List<EntityConfig> parse(List<dynamic> metaJson) {
    return metaJson.map((entity) {
      final entityMap = entity as Map<String, dynamic>;
      final slug = entityMap['slug'] as String;
      final name = entityMap['name'] as String? ?? _slugToName(slug);
      final namePlural = entityMap['name_plural'] as String? ?? '${name}s';
      final fields = _parseFields(entityMap['fields'] as List? ?? []);
      final softDelete = entityMap['soft_delete'] as bool? ?? false;
      final searchableFields = (entityMap['searchable_fields'] as List?)
              ?.map((e) => e.toString())
              .toList() ??
          [];

      return EntityConfig(
        slug: slug,
        name: name,
        namePlural: namePlural,
        fields: fields,
        softDelete: softDelete,
        searchableFields: searchableFields,
      );
    }).toList();
  }

  static List<FieldConfig> _parseFields(List<dynamic> fieldsJson) {
    return fieldsJson.map((field) {
      final fieldMap = field as Map<String, dynamic>;
      final key = fieldMap['key'] as String;
      final label = fieldMap['label'] as String? ?? _keyToLabel(key);
      final type = fieldMap['type'] as String? ?? 'str';
      final fieldTypeStr = fieldMap['field_type'] as String? ?? 'text';
      final options =
          (fieldMap['options'] as List?)?.map((e) => e.toString()).toList();

      String? foreignKeyEntity;
      if (fieldMap['has_foreign_key'] == true && key.endsWith('_id')) {
        foreignKeyEntity = key.substring(0, key.length - 3);
      }

      return FieldConfig(
        key: key,
        label: label,
        type: type,
        fieldType: FieldType.fromString(fieldTypeStr),
        nullable: fieldMap['nullable'] as bool? ?? false,
        isAuto: fieldMap['is_auto'] as bool? ?? false,
        isPrimaryKey: fieldMap['is_primary_key'] as bool? ?? false,
        filterable: fieldMap['filterable'] as bool? ?? true,
        hasForeignKey: fieldMap['has_foreign_key'] as bool? ?? false,
        foreignKeyEntity: foreignKeyEntity,
        maxLength: fieldMap['max_length'] as int?,
        options: options,
      );
    }).toList();
  }

  static String _slugToName(String slug) {
    return slug
        .split('_')
        .map(
          (word) => word.isEmpty
              ? ''
              : '${word[0].toUpperCase()}${word.substring(1)}',
        )
        .join(' ');
  }

  static String _keyToLabel(String key) {
    return key
        .replaceAll('_', ' ')
        .split(' ')
        .map(
          (word) => word.isEmpty
              ? ''
              : '${word[0].toUpperCase()}${word.substring(1)}',
        )
        .join(' ');
  }
}
