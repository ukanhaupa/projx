import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/entities/entity_overrides.dart';
import 'package:projx_mobile/features/entity/widgets/entity_list_tile.dart';

const _config = EntityConfig(
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
        isPrimaryKey: true),
    FieldConfig(
        key: 'name', label: 'Name', type: 'str', fieldType: FieldType.text),
  ],
);

Widget _harness(EntityListTile tile) =>
    MaterialApp(home: Scaffold(body: ListView(children: [tile])));

void main() {
  testWidgets('renders title from name field', (tester) async {
    await tester.pumpWidget(_harness(EntityListTile(
      config: _config,
      item: const {'id': 1, 'name': 'Wrench'},
      onTap: () {},
      onEdit: () {},
      onDelete: () {},
    )));

    expect(find.text('Wrench'), findsOneWidget);
  });

  testWidgets('falls back to #id when name/title/label are absent',
      (tester) async {
    await tester.pumpWidget(_harness(EntityListTile(
      config: const EntityConfig(
        slug: 'x',
        name: 'X',
        namePlural: 'Xs',
        fields: [
          FieldConfig(
              key: 'id',
              label: 'ID',
              type: 'int',
              fieldType: FieldType.number,
              isPrimaryKey: true)
        ],
      ),
      item: const {'id': 42},
      onTap: () {},
      onEdit: () {},
      onDelete: () {},
    )));

    expect(find.text('#42'), findsOneWidget);
  });

  testWidgets('tapping the tile invokes onTap', (tester) async {
    var tapped = false;
    await tester.pumpWidget(_harness(EntityListTile(
      config: _config,
      item: const {'id': 1, 'name': 'WrenchTitle'},
      onTap: () => tapped = true,
      onEdit: () {},
      onDelete: () {},
    )));
    await tester.tap(find.byType(ListTile));
    expect(tapped, isTrue);
  });

  testWidgets('tapping the edit button invokes onEdit', (tester) async {
    var edited = false;
    await tester.pumpWidget(_harness(EntityListTile(
      config: _config,
      item: const {'id': 1, 'name': 'A'},
      onTap: () {},
      onEdit: () => edited = true,
      onDelete: () {},
    )));
    await tester.tap(find.byIcon(Icons.edit_outlined));
    expect(edited, isTrue);
  });

  testWidgets('swipe-to-dismiss invokes onDelete', (tester) async {
    var deleted = false;
    await tester.pumpWidget(_harness(EntityListTile(
      config: _config,
      item: const {'id': 1, 'name': 'SwipeMe'},
      onTap: () {},
      onEdit: () {},
      onDelete: () => deleted = true,
    )));
    await tester.drag(find.byType(ListTile), const Offset(-500, 0));
    await tester.pumpAndSettle();
    expect(deleted, isTrue);
  });

  testWidgets('uses entity override list tile builder when provided',
      (tester) async {
    final override = EntityOverride(
      listTileBuilder: (_, __, item) => Text('CUSTOM ${item['name']}'),
    );

    await tester.pumpWidget(_harness(EntityListTile(
      config: _config,
      item: const {'id': 1, 'name': 'A'},
      entityOverride: override,
      onTap: () {},
      onEdit: () {},
      onDelete: () {},
    )));

    expect(find.text('CUSTOM A'), findsOneWidget);
  });
}
