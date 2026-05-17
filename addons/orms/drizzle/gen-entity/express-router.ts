import type { Express } from 'express';
import type { DbClient } from '../../db/client.js';
import { __TABLE_CAMEL__ } from '../../db/schema.js';
import { registerEntityRoutes } from '../_base/index.js';

export function register__ENTITY_PASCAL__Entity(app: Express, db: DbClient): void {
  app.use(
    '/api/v1__API_PREFIX__',
    registerEntityRoutes(
      {
        name: '__ENTITY_PASCAL__',
        apiPrefix: '__API_PREFIX__',
        tag: '__TAG__',
        table: __TABLE_CAMEL__,
        searchableFields: [__SEARCHABLE_FIELDS_ARRAY__],
        bulkOperations: __BULK_OPERATIONS__,
      },
      db,
    ),
  );
}
