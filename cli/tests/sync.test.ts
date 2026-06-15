import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from '../src/scaffold.js';
import {
  META_SCHEMAS_PATH,
  fetchSchemas,
  pickBackend,
  renderInterface,
  resolveBaseUrl,
  syncTypes,
  toKebab,
  toPascal,
  tsTypeFor,
  type BackendEntity,
  type SchemasDocument,
} from '../src/sync.js';

const REPO_DIR = join(import.meta.dirname, '../..');

const widgetEntity: BackendEntity = {
  name: 'widget',
  table_name: 'widgets',
  base_path: '/widgets',
  api_path: '/api/v1/widgets',
  soft_delete: false,
  searchable_fields: ['name'],
  hidden_fields: [],
  fields: [
    {
      name: 'ID',
      json_name: 'id',
      db_name: 'id',
      type: 'string',
      nullable: false,
      primary_key: true,
    },
    {
      name: 'Name',
      json_name: 'name',
      db_name: 'name',
      type: 'string',
      nullable: false,
    },
    {
      name: 'Count',
      json_name: 'count',
      db_name: 'count',
      type: 'int64',
      nullable: true,
    },
    {
      name: 'CreatedAt',
      json_name: 'created_at',
      db_name: 'created_at',
      type: 'time.Time',
      nullable: false,
    },
  ],
};

describe('sync helpers', () => {
  it('tsTypeFor maps Go primitives', () => {
    expect(tsTypeFor('string')).toBe('string');
    expect(tsTypeFor('int64')).toBe('number');
    expect(tsTypeFor('float64')).toBe('number');
    expect(tsTypeFor('bool')).toBe('boolean');
    expect(tsTypeFor('time.Time')).toBe('string');
    expect(tsTypeFor('uuid.UUID')).toBe('string');
    expect(tsTypeFor('weird.Custom')).toBe('unknown');
  });

  it('toPascal/toKebab handle snake and kebab', () => {
    expect(toPascal('audit_log')).toBe('AuditLog');
    expect(toPascal('audit-log')).toBe('AuditLog');
    expect(toKebab('AuditLog')).toBe('audit-log');
    expect(toKebab('audit_log')).toBe('audit-log');
  });

  it('renderInterface emits an exported TS interface', () => {
    const out = renderInterface(widgetEntity);
    expect(out).toContain('export interface Widget {');
    expect(out).toContain('id: string;');
    expect(out).toContain('name: string;');
    expect(out).toContain('count?: number;');
    expect(out).toContain('created_at: string;');
  });

  it('pickBackend prefers explicit override and validates presence', () => {
    expect(pickBackend(['fastify', 'vitejs'])).toBe('fastify');
    expect(pickBackend(['go', 'vitejs'])).toBe('go');
    expect(pickBackend(['go', 'vitejs'], 'go')).toBe('go');
    expect(() => pickBackend(['fastify', 'vitejs'], 'go')).toThrow(
      /not found in this project/,
    );
    expect(() => pickBackend(['vitejs'])).toThrow(/No backend component/);
  });

  it('resolveBaseUrl uses per-backend default and trims trailing slash', () => {
    expect(resolveBaseUrl('go')).toBe('http://localhost:8080');
    expect(resolveBaseUrl('fastify')).toBe('http://localhost:3000');
    expect(resolveBaseUrl('go', 'http://api.local:9000/')).toBe(
      'http://api.local:9000',
    );
  });
});

describe('fetchSchemas', () => {
  it('hits the meta path and returns the parsed document', async () => {
    const doc: SchemasDocument = { entities: { widget: widgetEntity } };
    let calledUrl = '';
    const fakeFetch = (async (url: string) => {
      calledUrl = url;
      return new Response(JSON.stringify(doc), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const out = await fetchSchemas('http://localhost:8080', fakeFetch);
    expect(calledUrl).toBe(`http://localhost:8080${META_SCHEMAS_PATH}`);
    expect(out.entities.widget.name).toBe('widget');
  });

  it('throws when status is not ok', async () => {
    const fakeFetch = (async () =>
      new Response('boom', {
        status: 500,
        statusText: 'Internal Server Error',
      })) as unknown as typeof fetch;
    await expect(fetchSchemas('http://x', fakeFetch)).rejects.toThrow(/500/);
  });

  it('throws when the body lacks an entities key', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    await expect(fetchSchemas('http://x', fakeFetch)).rejects.toThrow(
      /Invalid schemas response/,
    );
  });
});

describe('syncTypes', () => {
  let dest: string;

  afterEach(async () => {
    if (dest)
      await rm(dest, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
  });

  it('writes types into vitejs/src/types and updates the barrel', async () => {
    dest = join(tmpdir(), `projx-sync-${Date.now()}`);
    await scaffold(
      {
        name: 'sync-app',
        components: ['vitejs', 'go'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const doc: SchemasDocument = { entities: { widget: widgetEntity } };
    const fakeFetch = (async () =>
      new Response(JSON.stringify(doc), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    const result = await syncTypes(dest, { fetchImpl: fakeFetch });
    expect(result.backend).toBe('go');
    expect(result.baseUrl).toBe('http://localhost:8080');
    expect(result.written).toContain('src/types/widget.ts');

    const typeFile = await readFile(
      join(dest, 'vitejs/src/types/widget.ts'),
      'utf-8',
    );
    expect(typeFile).toContain('export interface Widget');
    const barrel = await readFile(
      join(dest, 'vitejs/src/types/index.ts'),
      'utf-8',
    );
    expect(barrel).toContain("export * from './widget';");
  });

  it('merges with an existing barrel without duplicating lines', async () => {
    dest = join(tmpdir(), `projx-sync-merge-${Date.now()}`);
    await scaffold(
      {
        name: 'sync-app',
        components: ['vitejs', 'go'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );
    const typesDir = join(dest, 'vitejs/src/types');
    await mkdir(typesDir, { recursive: true });
    await writeFile(
      join(typesDir, 'index.ts'),
      "export * from './widget';\nexport * from './other';\n",
    );

    const doc: SchemasDocument = { entities: { widget: widgetEntity } };
    const fakeFetch = (async () =>
      new Response(JSON.stringify(doc), {
        status: 200,
      })) as unknown as typeof fetch;

    await syncTypes(dest, { fetchImpl: fakeFetch });
    const barrel = await readFile(join(typesDir, 'index.ts'), 'utf-8');
    const widgetLines = barrel
      .split('\n')
      .filter((l) => l === "export * from './widget';");
    expect(widgetLines).toHaveLength(1);
    expect(barrel).toContain("export * from './other';");
  });

  it('throws when frontend is not present', async () => {
    dest = join(tmpdir(), `projx-sync-nofrontend-${Date.now()}`);
    await scaffold(
      { name: 'sync-app', components: ['go'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await expect(
      syncTypes(dest, {
        fetchImpl: (async () =>
          new Response('{}', { status: 200 })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/No frontend component/);
  });
});
