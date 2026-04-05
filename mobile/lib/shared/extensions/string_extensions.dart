extension StringExtensions on String {
  String capitalize() {
    if (isEmpty) return this;
    return '${this[0].toUpperCase()}${substring(1)}';
  }

  String truncate(int maxLength, {String suffix = '...'}) {
    if (length <= maxLength) return this;
    return '${substring(0, maxLength - suffix.length)}$suffix';
  }

  String pluralize({int count = 2}) {
    if (count == 1) return this;
    if (endsWith('y')) return '${substring(0, length - 1)}ies';
    if (endsWith('s') ||
        endsWith('x') ||
        endsWith('z') ||
        endsWith('ch') ||
        endsWith('sh')) {
      return '${this}es';
    }
    return '${this}s';
  }

  String toSnakeCase() {
    return replaceAllMapped(
      RegExp(r'[A-Z]'),
      (match) => '_${match.group(0)!.toLowerCase()}',
    ).replaceFirst('_', '');
  }

  String toTitleCase() {
    return split(RegExp(r'[_\s-]'))
        .where((word) => word.isNotEmpty)
        .map((word) => word.capitalize())
        .join(' ');
  }
}
