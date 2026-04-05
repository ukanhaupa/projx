import 'package:isar/isar.dart';

part 'pending_mutation.g.dart';

@collection
class PendingMutation {
  Id id = Isar.autoIncrement;

  @Index()
  late String entitySlug;

  late String method;
  String? remoteId;
  late String jsonData;
  late DateTime createdAt;
  late int retryCount;
}
