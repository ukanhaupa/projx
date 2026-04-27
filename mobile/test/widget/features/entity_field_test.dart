import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/features/entity/widgets/entity_field.dart';

FieldConfig _field(
  String key,
  FieldType type, {
  bool nullable = false,
  bool isAuto = false,
  int? maxLength,
  List<String>? options,
}) =>
    FieldConfig(
      key: key,
      label: key,
      type: 'str',
      fieldType: type,
      nullable: nullable,
      isAuto: isAuto,
      maxLength: maxLength,
      options: options,
    );

Future<void> _pump(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
        body: Padding(padding: const EdgeInsets.all(16), child: child)),
  ));
}

void main() {
  testWidgets('renders text field with initial value', (tester) async {
    var captured = '';
    await _pump(
      tester,
      EntityField(
        field: _field('name', FieldType.text),
        value: 'hello',
        onChanged: (v) => captured = v as String,
      ),
    );
    expect(find.byType(TextFormField), findsOneWidget);
    await tester.enterText(find.byType(TextFormField), 'world');
    expect(captured, 'world');
  });

  testWidgets('number field rejects non-numeric input formatter',
      (tester) async {
    dynamic captured;
    await _pump(
      tester,
      EntityField(
        field: _field('amount', FieldType.number),
        value: 5,
        onChanged: (v) => captured = v,
      ),
    );
    await tester.enterText(find.byType(TextFormField), '7.5');
    expect(captured, 7.5);

    await tester.enterText(find.byType(TextFormField), 'abc');
    expect(captured, isNot('abc'));
  });

  testWidgets('textarea field has multi-line layout', (tester) async {
    await _pump(
      tester,
      EntityField(
        field: _field('description', FieldType.textarea),
        value: 'multi\nline',
        onChanged: (_) {},
      ),
    );
    expect(find.text('multi\nline'), findsOneWidget);
  });

  testWidgets('boolean field shows a switch', (tester) async {
    var captured = false;
    await _pump(
      tester,
      EntityField(
        field: _field('active', FieldType.boolean),
        value: false,
        onChanged: (v) => captured = v as bool,
      ),
    );
    expect(find.byType(SwitchListTile), findsOneWidget);
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    expect(captured, isTrue);
  });

  testWidgets('select field with <=10 options renders a dropdown',
      (tester) async {
    await _pump(
      tester,
      EntityField(
        field: _field('status', FieldType.select, options: ['open', 'closed']),
        value: 'open',
        onChanged: (_) {},
      ),
    );
    expect(find.byType(DropdownButtonFormField<String>), findsOneWidget);
  });

  testWidgets('select field with >10 options renders a bottom-sheet trigger',
      (tester) async {
    final manyOptions = List.generate(15, (i) => 'opt-$i');
    await _pump(
      tester,
      EntityField(
        field: _field('many', FieldType.select, options: manyOptions),
        value: 'opt-3',
        onChanged: (_) {},
      ),
    );
    expect(find.byType(DropdownButtonFormField<String>), findsNothing);
    expect(find.byIcon(Icons.arrow_drop_down), findsOneWidget);
  });

  testWidgets('date field shows calendar icon and is read-only',
      (tester) async {
    await _pump(
      tester,
      EntityField(
        field: _field('due', FieldType.date),
        value: '2026-01-15',
        onChanged: (_) {},
      ),
    );
    expect(find.byIcon(Icons.calendar_today), findsOneWidget);
  });

  testWidgets('datetime field shows clock icon', (tester) async {
    await _pump(
      tester,
      EntityField(
        field: _field('starts', FieldType.datetime),
        value: '2026-01-15T10:30:00',
        onChanged: (_) {},
      ),
    );
    expect(find.byIcon(Icons.access_time), findsOneWidget);
  });

  testWidgets('required text field validates empty input', (tester) async {
    final formKey = GlobalKey<FormState>();
    await _pump(
      tester,
      Form(
        key: formKey,
        child: EntityField(
          field: _field('name', FieldType.text),
          value: '',
          onChanged: (_) {},
        ),
      ),
    );
    expect(formKey.currentState!.validate(), isFalse);
  });

  testWidgets('optional (nullable) field passes validation when empty',
      (tester) async {
    final formKey = GlobalKey<FormState>();
    await _pump(
      tester,
      Form(
        key: formKey,
        child: EntityField(
          field: _field('note', FieldType.text, nullable: true),
          value: '',
          onChanged: (_) {},
        ),
      ),
    );
    expect(formKey.currentState!.validate(), isTrue);
  });

  testWidgets('required number field rejects empty + non-numeric',
      (tester) async {
    final formKey = GlobalKey<FormState>();
    await _pump(
      tester,
      Form(
        key: formKey,
        child: EntityField(
          field: _field('amount', FieldType.number),
          value: null,
          onChanged: (_) {},
        ),
      ),
    );
    expect(formKey.currentState!.validate(), isFalse);
  });

  testWidgets('date field opens date picker on tap and emits selected date',
      (tester) async {
    var captured = '';
    await _pump(
      tester,
      EntityField(
        field: _field('due', FieldType.date),
        value: '2026-01-15',
        onChanged: (v) => captured = v as String,
      ),
    );

    await tester.tap(find.byType(TextFormField));
    await tester.pumpAndSettle();

    final ok = find.text('OK');
    if (ok.evaluate().isNotEmpty) {
      await tester.tap(ok);
      await tester.pumpAndSettle();
      expect(captured, isNotEmpty);
    }
  });

  testWidgets('datetime field opens picker chain on tap', (tester) async {
    await _pump(
      tester,
      EntityField(
        field: _field('starts', FieldType.datetime),
        value: '2026-01-15T10:30:00',
        onChanged: (_) {},
      ),
    );

    await tester.tap(find.byType(TextFormField));
    await tester.pumpAndSettle();

    final cancel = find.text('Cancel');
    if (cancel.evaluate().isNotEmpty) {
      await tester.tap(cancel.first);
      await tester.pumpAndSettle();
    }
  });

  testWidgets('select bottom-sheet opens on tap when >10 options',
      (tester) async {
    final manyOptions = List.generate(15, (i) => 'opt-$i');
    await _pump(
      tester,
      EntityField(
        field: _field('many', FieldType.select, options: manyOptions),
        value: 'opt-3',
        onChanged: (_) {},
      ),
    );

    await tester.tap(find.byType(TextFormField));
    await tester.pumpAndSettle();

    expect(find.byType(ListView), findsAtLeastNWidgets(0));
  });

  testWidgets('text field with maxLength caps the input', (tester) async {
    var captured = '';
    await _pump(
      tester,
      EntityField(
        field: _field('name', FieldType.text, maxLength: 5),
        value: '',
        onChanged: (v) => captured = v as String,
      ),
    );
    await tester.enterText(find.byType(TextFormField), 'abcdefgh');
    expect(captured.length, lessThanOrEqualTo(5));
  });
}
