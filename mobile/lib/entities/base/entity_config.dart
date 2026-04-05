class EntityConfig {
  final String slug;
  final String name;
  final String namePlural;
  final List<FieldConfig> fields;
  final bool softDelete;
  final List<String> searchableFields;
  final String? icon;

  const EntityConfig({
    required this.slug,
    required this.name,
    required this.namePlural,
    required this.fields,
    this.softDelete = false,
    this.searchableFields = const [],
    this.icon,
  });

  List<FieldConfig> get visibleFields =>
      fields.where((f) => !f.isAuto || f.isPrimaryKey).toList();

  List<FieldConfig> get formFields => fields.where((f) => !f.isAuto).toList();

  List<FieldConfig> get filterableFields =>
      fields.where((f) => f.filterable).toList();

  List<FieldConfig> get listDisplayFields {
    final nonAuto = fields.where((f) => !f.isAuto && !f.isPrimaryKey).toList();
    return nonAuto.take(4).toList();
  }

  FieldConfig? get primaryField {
    final nameFields = fields.where(
      (f) => f.key == 'name' || f.key == 'title' || f.key == 'label',
    );
    if (nameFields.isNotEmpty) return nameFields.first;
    final textFields = fields.where(
      (f) => f.fieldType == FieldType.text && !f.isAuto && !f.isPrimaryKey,
    );
    return textFields.isNotEmpty ? textFields.first : null;
  }

  FieldConfig? get subtitleField {
    final primary = primaryField;
    final candidates = fields.where(
      (f) =>
          f != primary &&
          !f.isAuto &&
          !f.isPrimaryKey &&
          (f.fieldType == FieldType.text || f.fieldType == FieldType.select),
    );
    return candidates.isNotEmpty ? candidates.first : null;
  }

  bool get isReadOnly => false;
}

class FieldConfig {
  final String key;
  final String label;
  final String type;
  final FieldType fieldType;
  final bool nullable;
  final bool isAuto;
  final bool isPrimaryKey;
  final bool filterable;
  final bool hasForeignKey;
  final String? foreignKeyEntity;
  final int? maxLength;
  final List<String>? options;

  const FieldConfig({
    required this.key,
    required this.label,
    required this.type,
    required this.fieldType,
    this.nullable = false,
    this.isAuto = false,
    this.isPrimaryKey = false,
    this.filterable = true,
    this.hasForeignKey = false,
    this.foreignKeyEntity,
    this.maxLength,
    this.options,
  });

  bool get isRequired => !nullable && !isAuto;
}

enum FieldType {
  text,
  number,
  date,
  datetime,
  textarea,
  boolean,
  select;

  static FieldType fromString(String value) {
    return switch (value) {
      'text' => FieldType.text,
      'number' => FieldType.number,
      'date' => FieldType.date,
      'datetime' => FieldType.datetime,
      'textarea' => FieldType.textarea,
      'boolean' => FieldType.boolean,
      'select' => FieldType.select,
      _ => FieldType.text,
    };
  }
}
