import type { Express } from 'express';
import { __ENTITY_PASCAL__ } from '../../entities/__ENTITY_KEBAB__.js';
import { registerEntityRoutes } from '../_base/index.js';

export function register__ENTITY_PASCAL__Entity(app: Express): void {
  app.use(
    '/api/v1__API_PREFIX__',
    registerEntityRoutes({
      name: '__ENTITY_PASCAL__',
      apiPrefix: '__API_PREFIX__',
      tag: '__TAG__',
      entity: __ENTITY_PASCAL__,
      searchableFields: [__SEARCHABLE_FIELDS_ARRAY__],
      bulkOperations: __BULK_OPERATIONS__,
    }),
  );
}
