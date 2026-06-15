import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from '../src/scaffold.js';
import { gen } from '../src/gen.js';

const REPO_DIR = join(import.meta.dirname, '../..');

describe('gen entity (go + sqlc)', () => {
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

  it('generates product.sql with sqlc annotations covering reads', async () => {
    dest = join(tmpdir(), `projx-gen-sqlc-sql-${Date.now()}`);
    await scaffold(
      {
        name: 'sqlc-app',
        components: ['go'],
        orm: 'sqlc',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      'product',
      'title:string,price:number,published:boolean',
      undefined,
      REPO_DIR,
    );

    const sqlPath = join(dest, 'go/internal/product/product.sql');
    expect(existsSync(sqlPath)).toBe(true);

    const sql = await readFile(sqlPath, 'utf-8');
    expect(sql).toMatch(/-- name: GetProduct :one[\s\S]*SELECT/);
    expect(sql).toMatch(/-- name: ListProduct :many[\s\S]*SELECT/);
    expect(sql).toMatch(/-- name: CountProduct :one/);
    expect(sql).toContain('FROM products');
  }, 60000);

  it('generates adapter that references the Querier interface', async () => {
    dest = join(tmpdir(), `projx-gen-sqlc-adapter-${Date.now()}`);
    await scaffold(
      {
        name: 'sqlc-app',
        components: ['go'],
        orm: 'sqlc',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      'product',
      'title:string,price:number,published:boolean',
      undefined,
      REPO_DIR,
    );

    const adapterPath = join(dest, 'go/internal/product/product.go');
    expect(existsSync(adapterPath)).toBe(true);

    const adapter = await readFile(adapterPath, 'utf-8');
    expect(adapter).toContain('package product');
    expect(adapter).toContain('"projx.local/go/internal/entities"');
    expect(adapter).toContain('entities.Querier');
    expect(adapter).toContain('func NewQuerier(pool *sql.DB) entities.Querier');
    expect(adapter).toContain(
      'func Config(pool *sql.DB) entities.EntityConfig',
    );
    expect(adapter).toContain('Name:             "product",');
    expect(adapter).toContain('BasePath:         "/products",');
    expect(adapter).toContain('SoftDelete:       false,');
    expect(adapter).toMatch(/INSERT INTO\s+`\+tableName/);
    expect(adapter).toMatch(/UPDATE\s+`\+tableName/);
    expect(adapter).toMatch(/DELETE FROM\s+`\+tableName/);
  }, 60000);

  it('generates a smoke test alongside the adapter', async () => {
    dest = join(tmpdir(), `projx-gen-sqlc-test-${Date.now()}`);
    await scaffold(
      {
        name: 'sqlc-app',
        components: ['go'],
        orm: 'sqlc',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      'product',
      'title:string,price:number',
      undefined,
      REPO_DIR,
    );

    const testPath = join(dest, 'go/internal/product/product_test.go');
    expect(existsSync(testPath)).toBe(true);

    const content = await readFile(testPath, 'utf-8');
    expect(content).toContain('package product');
    expect(content).toContain('func TestConfigShape(t *testing.T)');
    expect(content).toContain('assert.Equal(t, "product", cfg.Name)');
    expect(content).toContain('require.NotNil(t, cfg.Querier)');
  }, 60000);

  it('emits timestamped up + down migration files', async () => {
    dest = join(tmpdir(), `projx-gen-sqlc-migr-${Date.now()}`);
    await scaffold(
      {
        name: 'sqlc-app',
        components: ['go'],
        orm: 'sqlc',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      'product',
      'title:string,price:number',
      undefined,
      REPO_DIR,
    );

    const migrationsDir = join(dest, 'go/migrations');
    const files = await readdir(migrationsDir);
    const up = files.find((f) => /^\d+_add_product\.up\.sql$/.test(f));
    const down = files.find((f) => /^\d+_add_product\.down\.sql$/.test(f));
    expect(up).toBeDefined();
    expect(down).toBeDefined();

    const upSql = await readFile(join(migrationsDir, up!), 'utf-8');
    expect(upSql).toContain('CREATE TABLE IF NOT EXISTS products');
    expect(upSql).toContain('id          UUID PRIMARY KEY');
    expect(upSql).toMatch(/title\s+VARCHAR\(255\)/);
    expect(upSql).not.toContain('deleted_at');

    const downSql = await readFile(join(migrationsDir, down!), 'utf-8');
    expect(downSql).toContain('products');
  }, 60000);

  it('wires entity import and registration into main.go', async () => {
    dest = join(tmpdir(), `projx-gen-sqlc-main-${Date.now()}`);
    await scaffold(
      {
        name: 'sqlc-app',
        components: ['go'],
        orm: 'sqlc',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'product', 'title:string', undefined, REPO_DIR);

    const main = await readFile(join(dest, 'go/main.go'), 'utf-8');
    expect(main).toMatch(
      /\/\/ projx-anchor: entity-imports\s*\n\s*"projx\.local\/go\/internal\/product"/,
    );
    expect(main).toMatch(
      /\/\/ projx-anchor: entity-registrations\s*\n\s*entities\.Register\(product\.Config\(pool\)\)/,
    );
  }, 60000);

  it('is idempotent — gen entity twice produces no duplicate wiring', async () => {
    dest = join(tmpdir(), `projx-gen-sqlc-idem-${Date.now()}`);
    await scaffold(
      {
        name: 'sqlc-app',
        components: ['go'],
        orm: 'sqlc',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'product', 'title:string', undefined, REPO_DIR);
    await gen(dest, 'product', 'title:string', undefined, REPO_DIR);

    const main = await readFile(join(dest, 'go/main.go'), 'utf-8');
    const imports = main.match(/"projx\.local\/go\/internal\/product"/g);
    const regs = main.match(/entities\.Register\(product\.Config\(pool\)\)/g);
    expect(imports?.length).toBe(1);
    expect(regs?.length).toBe(1);

    const migrationsDir = join(dest, 'go/migrations');
    const ups = (await readdir(migrationsDir)).filter((f) =>
      /^\d+_add_product\.up\.sql$/.test(f),
    );
    expect(ups.length).toBe(1);
  }, 60000);

  it('no-soft-delete path produces no deleted_at column or filter', async () => {
    dest = join(tmpdir(), `projx-gen-sqlc-no-soft-${Date.now()}`);
    await scaffold(
      {
        name: 'sqlc-app',
        components: ['go'],
        orm: 'sqlc',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      'product',
      'title:string,price:number',
      undefined,
      REPO_DIR,
    );

    const sql = await readFile(
      join(dest, 'go/internal/product/product.sql'),
      'utf-8',
    );
    expect(sql).not.toContain('deleted_at');

    const adapter = await readFile(
      join(dest, 'go/internal/product/product.go'),
      'utf-8',
    );
    expect(adapter).toContain('SoftDelete:       false,');
    expect(adapter).toMatch(/DELETE FROM\s+`\+tableName/);
    expect(adapter).not.toMatch(/SET deleted_at = NOW\(\)/);

    const migrationsDir = join(dest, 'go/migrations');
    const upFile = (await readdir(migrationsDir)).find((f) =>
      /^\d+_add_product\.up\.sql$/.test(f),
    );
    const upSql = await readFile(join(migrationsDir, upFile!), 'utf-8');
    expect(upSql).not.toContain('deleted_at');
  }, 60000);

  it('generated adapter does not emit a stub "no filter columns" comment', async () => {
    dest = join(tmpdir(), `projx-gen-sqlc-no-filter-${Date.now()}`);
    await scaffold(
      {
        name: 'sqlc-app',
        components: ['go'],
        orm: 'sqlc',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'beacon', 'name:string', undefined, REPO_DIR);

    const adapter = await readFile(
      join(dest, 'go/internal/beacon/beacon.go'),
      'utf-8',
    );
    expect(adapter).not.toContain('// no filter columns');
  }, 60000);

  it('generated adapter BulkDelete returns affected count', async () => {
    dest = join(tmpdir(), `projx-gen-sqlc-bulk-${Date.now()}`);
    await scaffold(
      {
        name: 'sqlc-app',
        components: ['go'],
        orm: 'sqlc',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'product', 'title:string', undefined, REPO_DIR);

    const adapter = await readFile(
      join(dest, 'go/internal/product/product.go'),
      'utf-8',
    );
    expect(adapter).toContain(
      'func (q *querier) BulkDelete(ctx context.Context, ids []string) (int, error)',
    );
    expect(adapter).toContain('res.RowsAffected()');
    expect(adapter).toContain('return int(n), nil');
  }, 60000);
});
