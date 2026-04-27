import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/entities/entity_registry.dart';

void main() {
  late ProviderContainer container;

  setUp(() {
    container = ProviderContainer();
  });

  tearDown(() => container.dispose());

  EntityConfig makeConfig(String slug) => EntityConfig(
        slug: slug,
        name: slug,
        namePlural: slug,
        fields: const [],
        softDelete: false,
        searchableFields: const [],
      );

  test('starts empty', () {
    expect(container.read(entityRegistryProvider), isEmpty);
  });

  test('registerAll replaces the entire map', () {
    final notifier = container.read(entityRegistryProvider.notifier);
    notifier.registerAll([makeConfig('a'), makeConfig('b')]);

    final state = container.read(entityRegistryProvider);
    expect(state.keys, containsAll(['a', 'b']));
    expect(state.length, 2);
  });

  test('register adds a single entity, preserving existing entries', () {
    final notifier = container.read(entityRegistryProvider.notifier);
    notifier.register(makeConfig('a'));
    notifier.register(makeConfig('b'));

    final state = container.read(entityRegistryProvider);
    expect(state.keys, containsAll(['a', 'b']));
  });

  test('register overwrites a duplicate slug', () {
    final notifier = container.read(entityRegistryProvider.notifier);
    notifier.register(makeConfig('a'));
    notifier.register(makeConfig('a'));

    expect(container.read(entityRegistryProvider).length, 1);
  });

  test('clear empties the registry', () {
    final notifier = container.read(entityRegistryProvider.notifier);
    notifier.registerAll([makeConfig('a')]);
    notifier.clear();

    expect(container.read(entityRegistryProvider), isEmpty);
  });
}
