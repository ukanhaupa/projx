import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@clack/prompts', () => {
  return {
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
    log: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      step: vi.fn(),
      message: vi.fn(),
    },
    text: vi.fn(),
    select: vi.fn(),
    confirm: vi.fn(),
    multiselect: vi.fn(),
    isCancel: (v: unknown) => v === Symbol.for('clack.cancel'),
  };
});

import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as p from '@clack/prompts';
import { scaffold } from '../src/scaffold.js';
import { gen } from '../src/gen.js';

const REPO_DIR = join(import.meta.dirname, '../..');

describe('gen entity (interactive)', () => {
  let dest: string;

  afterEach(async () => {
    vi.clearAllMocks();
    if (dest)
      await rm(dest, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
  });

  it('drives the interactive prompt for a soft-delete entity with optional fields', async () => {
    dest = join(tmpdir(), `projx-genp-soft-${Date.now()}`);
    await scaffold(
      {
        name: 'gen-app',
        components: ['fastapi', 'vitejs', 'mobile'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    vi.mocked(p.text)
      .mockResolvedValueOnce('records' as never)
      .mockResolvedValueOnce('records' as never)
      .mockResolvedValueOnce('title' as never)
      .mockResolvedValueOnce('note' as never)
      .mockResolvedValueOnce('count' as never)
      .mockResolvedValueOnce('active' as never)
      .mockResolvedValueOnce('due' as never)
      .mockResolvedValueOnce('seen_at' as never)
      .mockResolvedValueOnce('meta' as never)
      .mockResolvedValueOnce('' as never);
    vi.mocked(p.select)
      .mockResolvedValueOnce('string' as never)
      .mockResolvedValueOnce('text' as never)
      .mockResolvedValueOnce('number' as never)
      .mockResolvedValueOnce('boolean' as never)
      .mockResolvedValueOnce('date' as never)
      .mockResolvedValueOnce('datetime' as never)
      .mockResolvedValueOnce('json' as never);
    vi.mocked(p.confirm)
      .mockResolvedValueOnce(false as never)
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(false as never)
      .mockResolvedValueOnce(false as never)
      .mockResolvedValueOnce(false as never)
      .mockResolvedValueOnce(false as never)
      .mockResolvedValueOnce(false as never)
      .mockResolvedValueOnce(false as never);
    vi.mocked(p.multiselect).mockResolvedValueOnce(['title'] as never);

    await gen(dest, 'record');

    const model = await readFile(
      join(dest, 'fastapi/src/entities/record/_model.py'),
      'utf-8',
    );
    expect(model).toContain('__soft_delete__ = True');
    expect(model).toContain('class Record(SoftDeleteMixin, BaseModel_):');
    expect(model).toContain('note = Column(Text, nullable=True)');
    expect(model).toContain('__searchable_fields__ = {"title"}');

    const iface = await readFile(
      join(dest, 'vitejs/src/types/record.ts'),
      'utf-8',
    );
    expect(iface).toContain('deleted_at: string | null;');
    expect(iface).toContain('note: string | null;');
    expect(iface).toContain('count: number | null;');
    expect(iface).toContain('count?: number | null;');

    const dart = await readFile(
      join(dest, 'mobile/lib/entities/record/model.dart'),
      'utf-8',
    );
    expect(dart).toContain('final DateTime? deletedAt;');
    expect(dart).toContain('final String? note;');
  });

  it('drives the interactive prompt for a readonly Fastify entity with no fields', async () => {
    dest = join(tmpdir(), `projx-genp-readonly-${Date.now()}`);
    await scaffold(
      { name: 'gen-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    vi.mocked(p.text)
      .mockResolvedValueOnce('snapshots' as never)
      .mockResolvedValueOnce('reports/snapshots' as never)
      .mockResolvedValueOnce('' as never);
    vi.mocked(p.confirm)
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(false as never);
    vi.mocked(p.multiselect).mockResolvedValueOnce([] as never);

    await gen(dest, 'snapshot');

    const index = await readFile(
      join(dest, 'fastify/src/modules/snapshot/index.ts'),
      'utf-8',
    );
    expect(index).toContain('readonly: true,');
    expect(index).toContain('softDelete: true,');
    expect(index).toContain('bulkOperations: false,');
    expect(index).toContain("apiPrefix: '/reports/snapshots',");

    const schemas = await readFile(
      join(dest, 'fastify/src/modules/snapshot/schemas.ts'),
      'utf-8',
    );
    expect(schemas).toContain('deleted_at:');
    expect(schemas).toContain('name: Type.String()');
  });

  it('prompts to resolve the primary backend when several exist', async () => {
    dest = join(tmpdir(), `projx-genp-primary-${Date.now()}`);
    await scaffold(
      {
        name: 'gen-app',
        components: ['fastapi', 'fastify'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const stdin = process.stdin as unknown as { isTTY: boolean };
    const prevTty = stdin.isTTY;
    stdin.isTTY = true;
    try {
      vi.mocked(p.select).mockResolvedValueOnce('fastify' as never);
      vi.mocked(p.text)
        .mockResolvedValueOnce('items' as never)
        .mockResolvedValueOnce('/items' as never)
        .mockResolvedValueOnce('label' as never)
        .mockResolvedValueOnce('' as never);
      vi.mocked(p.select).mockResolvedValueOnce('string' as never);
      vi.mocked(p.confirm)
        .mockResolvedValueOnce(false as never)
        .mockResolvedValueOnce(false as never)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(true as never);
      vi.mocked(p.multiselect).mockResolvedValueOnce(['label'] as never);

      await gen(dest, 'item');
    } finally {
      stdin.isTTY = prevTty;
    }

    expect(p.select).toHaveBeenCalled();
    expect(existsSync(join(dest, 'fastify/src/modules/item/schemas.ts'))).toBe(
      true,
    );

    const projx = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    expect(projx.primaryBackend).toBe('fastify');
  });
});
