// Aggregator for all Sequelize models. Each model module calls `Model.init(...)` at import
// time, attaching itself to the shared sequelize instance from `../db/client.js`.
// `gen entity` appends new model imports + exports below the anchors.

import { AuditLog } from './audit-log.js';

// projx-anchor: model-imports

export const models = {
  AuditLog,
  // projx-anchor: model-exports
};
