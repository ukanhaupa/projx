import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import prismaPlugin from '../../src/plugins/prisma.js';
import errorHandler from '../../src/plugins/error-handler.js';
import authPlugin from '../../src/plugins/auth.js';
import authzPlugin from '../../src/plugins/authz.js';
import { EntityRegistry, registerEntityRoutes } from '../../src/modules/_base/index.js';
import { config } from '../../src/config.js';

describe('Auth-protected routes (global)', () => {
  let app: FastifyInstance;
  const originalAuthEnabled = config.AUTH_ENABLED;

  beforeEach(async () => {
    (config as { AUTH_ENABLED: boolean }).AUTH_ENABLED = true;
    EntityRegistry.reset();

    app = Fastify({ logger: false });
    await app.register(prismaPlugin);
    await app.register(errorHandler);
    await app.register(authPlugin);
    await app.register(authzPlugin);

    EntityRegistry.register({
      name: 'AuditLog',
      tableName: 'audit_logs',
      prismaModel: 'AuditLog',
      apiPrefix: '/audit-logs',
      tags: ['audit-logs'],
      readonly: true,
      softDelete: false,
      bulkOperations: false,
      columnNames: [
        'id',
        'table_name',
        'record_id',
        'action',
        'old_value',
        'new_value',
        'performed_at',
        'performed_by',
        'created_at',
        'updated_at',
      ],
      searchableFields: ['table_name', 'record_id'],
      fields: [],
      schema: Type.Object({ id: Type.String() }),
      createSchema: Type.Object({ table_name: Type.String() }),
      updateSchema: Type.Object({}),
    });

    const entities = EntityRegistry.getAll();
    await app.register(
      async (instance) => {
        for (const entityConfig of entities) {
          await instance.register(
            async (entityInstance) => {
              registerEntityRoutes(entityInstance, entityConfig);
            },
            { prefix: entityConfig.apiPrefix },
          );
        }
      },
      { prefix: '/api/v1' },
    );

    await app.ready();
  });

  afterAll(async () => {
    (config as { AUTH_ENABLED: boolean }).AUTH_ENABLED = originalAuthEnabled;
    if (app) await app.close();
  });

  it('GET list returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit-logs' });
    expect(res.statusCode).toBe(401);
  });

  it('GET by id returns 401 without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET list succeeds with valid JWT and matching permission', async () => {
    const token = app.jwt.sign({ sub: 'user-1', permissions: ['audit_logs:read.all'] });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET list returns 403 with wrong resource permission', async () => {
    const token = app.jwt.sign({ sub: 'user-1', permissions: ['users:read.all'] });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
