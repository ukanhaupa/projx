import 'package:isar/isar.dart';

part 'cached_entity.g.dart';

@collection
class CachedEntity {
  Id id = Isar.autoIncrement;

  @Index()
  late String entitySlug;

  @Index()
  late String remoteId;

  late String jsonData;
  late DateTime cachedAt;
  DateTime? syncedAt;
}
