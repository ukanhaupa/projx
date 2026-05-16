import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sync } from '../src/sync.js';

interface MetaField {
  key: string;
  label: string;
  type: string;
  nullable: boolean;
  is_auto: boolean;
  is_primary_key: boolean;
  in_create: boolean;
  in_update: boolean;
  field_type: string;
  has_foreign_key: boolean;
}

const sampleMeta = {
  entities: [
    {
      name: 'invoice',
      table_name: 'invoices',
      api_prefix: '/invoices',
      readonly: false,
      soft_delete: false,
      fields: [
        mkField('id', 'int', false, {
          is_primary_key: true,
          is_auto: true,
          in_create: false,
          in_update: false,
        }),
        mkField('name', 'str', false),
        mkField('amount', 'float', false),
        mkField('note', 'str', true),
        mkField('issued_at', 'datetime', false),
        mkField('paid_at', 'date', true),
        mkField('active', 'bool', false),
        mkField('metadata', 'dict', true),
      ],
    },
  ],
};

function mkField(
  key: string,
  type: string,
  nullable: boolean,
  overrides: Partial<MetaField> = {},
): MetaField {
  return {
    key,
    label: key,
    type,
    nullable,
    is_auto: false,
    is_primary_key: false,
    in_create: true,
    in_update: true,
    field_type: type,
    has_foreign_key: false,
    ...overrides,
  };
}

async function makeProject(opts: {
  components: string[];
  envFile?: string;
  envContent?: string;
}): Promise<string> {
  const dir = join(
    tmpdir(),
    `projx-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, '.projx'),
    JSON.stringify({ version: '0', components: opts.components }),
  );
  for (const c of opts.components) {
    const compDir = join(dir, c);
    await mkdir(compDir, { recursive: true });
    await writeFile(
      join(compDir, '.projx-component'),
      JSON.stringify({ component: c, skip: [] }),
    );
  }
  if (opts.envFile && opts.envContent) {
    await writeFile(join(dir, opts.envFile), opts.envContent);
  }
  return dir;
}

function mockFetch(meta: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      json: async () => meta,
    })),
  );
}

describe('sync', () => {
  let dest = '';
  const origExit = process.exit;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
    dest = '';
    vi.unstubAllGlobals();
    process.exit = origExit;
  });

  it('generates TypeScript types for frontend', async () => {
    dest = await makeProject({ components: ['frontend'] });
    mockFetch(sampleMeta);

    await sync(dest, 'http://localhost:8000/api/v1/_meta');

    const filePath = join(dest, 'frontend/src/types/invoice.ts');
    expect(existsSync(filePath)).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('export interface Invoice');
    expect(content).toContain('export interface CreateInvoice');
    expect(content).toContain('export interface UpdateInvoice');
    expect(content).toContain('name: string');
    expect(content).toContain('amount: number');
    expect(content).toContain('note: string | null');
    expect(content).toContain('active: boolean');
    expect(content).toContain('metadata: Record<string, unknown> | null');
    expect(content).toContain('issued_at: string');

    const barrelPath = join(dest, 'frontend/src/types/index.ts');
    expect(existsSync(barrelPath)).toBe(true);
    const barrel = await readFile(barrelPath, 'utf-8');
    expect(barrel).toContain("export * from './invoice'");
  });

  it('generates Dart models for mobile', async () => {
    dest = await makeProject({ components: ['mobile'] });
    mockFetch(sampleMeta);

    await sync(dest, 'http://localhost:8000/api/v1/_meta');

    const filePath = join(dest, 'mobile/lib/entities/invoice/model.dart');
    expect(existsSync(filePath)).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('class Invoice {');
    expect(content).toContain('final String name;');
    expect(content).toContain('final double amount;');
    expect(content).toContain('final String? note;');
    expect(content).toContain('final DateTime issuedAt;');
    expect(content).toContain('final DateTime? paidAt;');
    expect(content).toContain('final bool active;');
    expect(content).toContain('final Map<String, dynamic>? metadata;');
    expect(content).toContain(
      'factory Invoice.fromJson(Map<String, dynamic> json)',
    );
    expect(content).toContain("DateTime.parse(json['issued_at'] as String)");
    expect(content).toContain(
      "json['paid_at'] != null ? DateTime.parse(json['paid_at'] as String) : null",
    );
    expect(content).toContain('Map<String, dynamic> toJson()');
    expect(content).toContain("'issued_at': issuedAt?.toIso8601String()");
    expect(content).toContain('Invoice copyWith({');
  });

  it('generates both frontend and mobile when both components exist', async () => {
    dest = await makeProject({ components: ['frontend', 'mobile'] });
    mockFetch(sampleMeta);

    await sync(dest);

    expect(existsSync(join(dest, 'frontend/src/types/invoice.ts'))).toBe(true);
    expect(
      existsSync(join(dest, 'mobile/lib/entities/invoice/model.dart')),
    ).toBe(true);
  });

  it('exits when .projx is missing', async () => {
    dest = join(tmpdir(), `projx-sync-noconfig-${Date.now()}`);
    await mkdir(dest, { recursive: true });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('EXIT');
    });
    mockFetch(sampleMeta);

    await expect(sync(dest)).rejects.toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when no frontend or mobile component is present', async () => {
    dest = await makeProject({ components: ['fastapi'] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('EXIT');
    });
    mockFetch(sampleMeta);

    await expect(sync(dest)).rejects.toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when fetch fails', async () => {
    dest = await makeProject({ components: ['frontend'] });
    mockFetch({}, false, 500);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('EXIT');
    });

    await expect(
      sync(dest, 'http://localhost:8000/api/v1/_meta'),
    ).rejects.toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('detects VITE_API_URL from project root .env', async () => {
    dest = await makeProject({
      components: ['frontend'],
      envFile: '.env',
      envContent: 'VITE_API_URL="http://api.example.com"\n',
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => sampleMeta,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await sync(dest);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.example.com/api/v1/_meta',
    );
  });

  it('detects VITE_API_URL from frontend/.env when root has none', async () => {
    dest = await makeProject({ components: ['frontend'] });
    await writeFile(
      join(dest, 'frontend/.env'),
      'VITE_API_URL=http://staging.api\n',
    );
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => sampleMeta,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await sync(dest);

    expect(fetchMock).toHaveBeenCalledWith('http://staging.api/api/v1/_meta');
  });

  it('falls back to localhost:8000 when no env hints found', async () => {
    dest = await makeProject({ components: ['frontend'] });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => sampleMeta,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await sync(dest);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/_meta',
    );
  });

  it('handles entities with multi-word and PascalCase names', async () => {
    dest = await makeProject({ components: ['frontend', 'mobile'] });
    mockFetch({
      entities: [
        {
          name: 'purchase_order',
          table_name: 'purchase_orders',
          api_prefix: '/purchase-orders',
          readonly: false,
          soft_delete: false,
          fields: [mkField('title', 'str', false)],
        },
      ],
    });

    await sync(dest);

    expect(existsSync(join(dest, 'frontend/src/types/purchase-order.ts'))).toBe(
      true,
    );
    expect(
      existsSync(join(dest, 'mobile/lib/entities/purchase_order/model.dart')),
    ).toBe(true);
    const dart = await readFile(
      join(dest, 'mobile/lib/entities/purchase_order/model.dart'),
      'utf-8',
    );
    expect(dart).toContain('class PurchaseOrder {');
  });
});
