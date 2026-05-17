import type { FastifyInstance } from 'fastify';
import { __TABLE_CAMEL__ } from '../../db/schema.js';
import { registerEntityRoutes } from '../_base/index.js';

export async function register__ENTITY_PASCAL__Entity(app: FastifyInstance): Promise<void> {
  await app.register(
    async (instance) => {
      registerEntityRoutes(instance, {
        name: '__ENTITY_PASCAL__',
        apiPrefix: '__API_PREFIX__',
        tag: '__TAG__',
        table: __TABLE_CAMEL__,
        searchableFields: [__SEARCHABLE_FIELDS_ARRAY__],
        bulkOperations: __BULK_OPERATIONS__,
      });
    },
    { prefix: '/api/v1__API_PREFIX__' },
  );
}
