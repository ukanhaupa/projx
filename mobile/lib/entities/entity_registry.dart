import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';

final entityRegistryProvider =
    StateNotifierProvider<EntityRegistryNotifier, Map<String, EntityConfig>>((
  ref,
) {
  return EntityRegistryNotifier();
});

class EntityRegistryNotifier extends StateNotifier<Map<String, EntityConfig>> {
  EntityRegistryNotifier() : super({});

  void registerAll(List<EntityConfig> configs) {
    state = {for (final config in configs) config.slug: config};
  }

  void register(EntityConfig config) {
    state = {...state, config.slug: config};
  }

  void clear() {
    state = {};
  }
}
