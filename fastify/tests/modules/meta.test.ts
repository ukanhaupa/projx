import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, superuserHeaders } from '../helpers/app.js';

describe('Meta endpoint', () => {
  let app: FastifyInstance;
  let headers: Record<string, string>;

  beforeEach(async () => {
    app = await buildTestApp();
    headers = superuserHeaders(app);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /api/v1/_meta returns entity metadata', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/_meta',
      headers,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entities).toBeDefined();
    expect(Array.isArray(body.entities)).toBe(true);
    expect(body.entities.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/_meta contains expected entity fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/_meta',
      headers,
    });

    const body = res.json();
    const auditLog = body.entities.find(
      (e: Record<string, unknown>) => e.name === 'AuditLog',
    );
    expect(auditLog).toBeDefined();
    expect(auditLog.table_name).toBe('audit_logs');
    expect(auditLog.api_prefix).toBe('/audit-logs');
    expect(auditLog.readonly).toBe(true);
    expect(auditLog.soft_delete).toBe(false);
    expect(auditLog.bulk_operations).toBe(false);
    expect(auditLog.fields).toBeDefined();
    expect(Array.isArray(auditLog.fields)).toBe(true);
  });

  it('GET /api/v1/_meta field metadata has expected shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/_meta',
      headers,
    });

    const body = res.json();
    const auditLog = body.entities.find(
      (e: Record<string, unknown>) => e.name === 'AuditLog',
    );
    const tableNameField = auditLog.fields.find(
      (f: Record<string, unknown>) => f.key === 'table_name',
    );

    expect(tableNameField).toBeDefined();
    expect(tableNameField.label).toBe('Table Name');
    expect(tableNameField.type).toBe('str');
    expect(tableNameField.nullable).toBe(false);
    expect(tableNameField.is_auto).toBe(false);
    expect(tableNameField.is_primary_key).toBe(false);
    expect(tableNameField.filterable).toBe(true);
    expect(tableNameField.has_foreign_key).toBe(false);
    expect(tableNameField.field_type).toBe('text');
  });

  it('GET /api/v1/_meta readonly entity has no bulk_operations', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/_meta',
      headers,
    });

    const body = res.json();
    const auditLog = body.entities.find(
      (e: Record<string, unknown>) => e.name === 'AuditLog',
    );
    expect(auditLog).toBeDefined();
    expect(auditLog.readonly).toBe(true);
    expect(auditLog.bulk_operations).toBe(false);
  });
});
