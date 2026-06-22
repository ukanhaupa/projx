// Aggregator for all TypeORM entity classes. The DataSource registers these
// in `../db/data-source.ts`. `gen entity` appends new imports + entries below the anchors.
import { AuditLog } from './audit-log.js';

// projx-anchor: model-imports

export const entities = [
  AuditLog,
  // projx-anchor: model-exports
];
