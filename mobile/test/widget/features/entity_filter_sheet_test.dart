import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/features/entity/widgets/entity_filter_sheet.dart';

const testConfig = EntityConfig(
  slug: 'products',
  name: 'Product',
  namePlural: 'Products',
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
      filterable: true,
    ),
    FieldConfig(
      key: 'price',
      label: 'Price',
      type: 'float',
      fieldType: FieldType.number,
      filterable: true,
    ),
    FieldConfig(
      key: 'active',
      label: 'Active',
      type: 'bool',
      fieldType: FieldType.boolean,
      filterable: true,
    ),
  ],
);

Widget buildFilterSheet({
  Map<String, String> currentFilters = const {},
  String? currentOrderBy,
  void Function(Map<String, String>, String?)? onApply,
}) {
  return MaterialApp(
    home: Scaffold(
      body: SizedBox(
        height: 600,
        child: EntityFilterSheet(
          config: testConfig,
          currentFilters: currentFilters,
          currentOrderBy: currentOrderBy,
          onApply: onApply ?? (_, __) {},
        ),
      ),
    ),
  );
}

void main() {
  group('EntityFilterSheet', () {
    testWidgets('shows "Filters & Sort" header', (tester) async {
      await tester.pumpWidget(buildFilterSheet());
      await tester.pumpAndSettle();

      expect(find.text('Filters & Sort'), findsOneWidget);
    });

    testWidgets('shows sort chips for sortable fields', (tester) async {
      await tester.pumpWidget(buildFilterSheet());
      await tester.pumpAndSettle();

      // Sortable fields are filterable + non-primary-key: name, price, active
      expect(find.byType(FilterChip), findsWidgets);
      // Each sortable field label should appear in a chip
      expect(find.text('Name'), findsWidgets);
      expect(find.text('Price'), findsWidgets);
      expect(find.text('Active'), findsWidgets);
    });

    testWidgets('shows filter fields for filterable fields', (tester) async {
      await tester.pumpWidget(buildFilterSheet());
      await tester.pumpAndSettle();

      // 'active' is boolean -> DropdownButtonFormField
      // 'name' is text -> TextField with label
      // 'price' is number -> TextField with label
      // The labels should appear as InputDecoration labelText
      expect(find.byType(TextField), findsWidgets);
    });

    testWidgets('shows apply button', (tester) async {
      await tester.pumpWidget(buildFilterSheet());
      await tester.pumpAndSettle();

      expect(find.text('Apply'), findsOneWidget);
      expect(find.byType(ElevatedButton), findsOneWidget);
    });

    testWidgets('shows clear all button', (tester) async {
      await tester.pumpWidget(buildFilterSheet());
      await tester.pumpAndSettle();

      expect(find.text('Clear all'), findsOneWidget);
    });
  });
}
