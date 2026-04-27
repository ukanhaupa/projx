import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';
import 'package:projx_mobile/entities/base/entity_providers.dart';
import 'package:projx_mobile/entities/entity_registry.dart';

void main() {
  group('EntityListParams equality', () {
    test('equal when slug/page/pageSize/search/orderBy match', () {
      const a = EntityListParams(slug: 'w', page: 1);
      const b = EntityListParams(slug: 'w', page: 1);
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('different when any compared field differs', () {
      expect(
        const EntityListParams(slug: 'w', page: 1),
        isNot(const EntityListParams(slug: 'w', page: 2)),
      );
      expect(
        const EntityListParams(slug: 'w', search: 'a'),
        isNot(const EntityListParams(slug: 'w', search: 'b')),
      );
      expect(
        const EntityListParams(slug: 'w'),
        isNot(const EntityListParams(slug: 'x')),
      );
    });
  });

  group('EntityDetailParams equality', () {
    test('equal when slug+id match', () {
      const a = EntityDetailParams(slug: 'w', id: '1');
      const b = EntityDetailParams(slug: 'w', id: '1');
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('different when slug or id differ', () {
      expect(
        const EntityDetailParams(slug: 'w', id: '1'),
        isNot(const EntityDetailParams(slug: 'w', id: '2')),
      );
      expect(
        const EntityDetailParams(slug: 'w', id: '1'),
        isNot(const EntityDetailParams(slug: 'x', id: '1')),
      );
    });
  });

  group('entityConfigProvider', () {
    test('returns null for unregistered slug', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      expect(container.read(entityConfigProvider('missing')), isNull);
    });

    test('returns the config once registered', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      const config = EntityConfig(
        slug: 'widgets',
        name: 'widget',
        namePlural: 'widgets',
        fields: [],
        softDelete: false,
        searchableFields: [],
      );
      container.read(entityRegistryProvider.notifier).register(config);
      expect(container.read(entityConfigProvider('widgets')), config);
    });
  });
}
