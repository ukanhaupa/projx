import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from '../src/scaffold.js';
import { gen } from '../src/gen.js';

const REPO_DIR = join(import.meta.dirname, '../..');

function hasGoToolchain(): boolean {
  try {
    execSync('go version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('gen entity (go + ent) — SoftDeleteMixin sourcing', () => {
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

  it('ships SoftDeleteMixin in shared ent/schema/mixins.go (not inside post.go)', async () => {
    dest = join(tmpdir(), `projx-ent-mixin-${Date.now()}`);
    await scaffold(
      {
        name: 'ent-mixin-app',
        components: ['go'],
        orm: 'ent',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const mixinsPath = join(dest, 'go/ent/schema/mixins.go');
    expect(existsSync(mixinsPath)).toBe(true);
    const mixins = await readFile(mixinsPath, 'utf-8');
    expect(mixins).toContain('package schema');
    expect(mixins).toMatch(/type\s+SoftDeleteMixin\s+struct/);
    expect(mixins).toContain('func (SoftDeleteMixin) Fields() []ent.Field');
    expect(mixins).toContain('func (SoftDeleteMixin) Indexes() []ent.Index');

    const postPath = join(dest, 'go/ent/schema/post.go');
    expect(existsSync(postPath)).toBe(true);
    const post = await readFile(postPath, 'utf-8');
    expect(post).not.toMatch(/type\s+SoftDeleteMixin\s+struct/);
    expect(post).toContain('SoftDeleteMixin{},');
  }, 60000);

  it('keeps SoftDeleteMixin defined after the sample post.go is deleted', async () => {
    dest = join(tmpdir(), `projx-ent-mixin-survives-${Date.now()}`);
    await scaffold(
      {
        name: 'ent-survive-app',
        components: ['go'],
        orm: 'ent',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await rm(join(dest, 'go/ent/schema/post.go'), { force: true });

    const mixinsPath = join(dest, 'go/ent/schema/mixins.go');
    expect(existsSync(mixinsPath)).toBe(true);
    const mixins = await readFile(mixinsPath, 'utf-8');
    expect(mixins).toMatch(/type\s+SoftDeleteMixin\s+struct/);
  }, 60000);

  it('generated entity schema lands in the same package as mixins.go', async () => {
    dest = join(tmpdir(), `projx-ent-gen-${Date.now()}`);
    await scaffold(
      {
        name: 'ent-gen-app',
        components: ['go'],
        orm: 'ent',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      'invoice',
      'title:string,amount:number',
      undefined,
      REPO_DIR,
    );

    const schemaPath = join(dest, 'go/ent/schema/invoice.go');
    expect(existsSync(schemaPath)).toBe(true);
    const schema = await readFile(schemaPath, 'utf-8');
    expect(schema).toContain('package schema');
    expect(schema).toMatch(/func\s+\(Invoice\)\s+Mixin\(\)\s+\[\]ent\.Mixin/);

    const mixinsPath = join(dest, 'go/ent/schema/mixins.go');
    expect(existsSync(mixinsPath)).toBe(true);
    const mixins = await readFile(mixinsPath, 'utf-8');
    expect(mixins).toMatch(/type\s+SoftDeleteMixin\s+struct/);
    expect(mixins).toContain('package schema');

    if (hasGoToolchain()) {
      let vetOutput: string;
      try {
        vetOutput = execSync('go vet ./ent/schema/...', {
          cwd: join(dest, 'go'),
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).toString();
      } catch (e) {
        const err = e as { stdout?: Buffer; stderr?: Buffer };
        vetOutput =
          (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
      }
      expect(vetOutput).not.toMatch(/undefined:\s*SoftDeleteMixin/);
    }
  }, 120000);
});

describe('gen entity (go + ent) — integration surface', () => {
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

  it('generates an ent.Schema-embedding type with Fields() for the entity', async () => {
    dest = join(tmpdir(), `projx-gen-ent-schema-${Date.now()}`);
    await scaffold(
      {
        name: 'ent-app',
        components: ['go'],
        orm: 'ent',
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

    const schemaPath = join(dest, 'go/ent/schema/product.go');
    expect(existsSync(schemaPath)).toBe(true);

    const schema = await readFile(schemaPath, 'utf-8');
    expect(schema).toContain('package schema');
    expect(schema).toMatch(/type\s+Product\s+struct\s*{\s*ent\.Schema\s*}/);
    expect(schema).toMatch(/func\s+\(Product\)\s+Fields\(\)\s+\[\]ent\.Field/);
    expect(schema).toContain('field.String("title")');
    expect(schema).toContain('field.Int("price")');
    expect(schema).toContain('field.Bool("published")');
  }, 60000);

  it('generates an adapter that wires the ent client into the Querier', async () => {
    dest = join(tmpdir(), `projx-gen-ent-adapter-${Date.now()}`);
    await scaffold(
      {
        name: 'ent-app',
        components: ['go'],
        orm: 'ent',
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
    expect(adapter).toContain('"projx.local/go/ent"');
    expect(adapter).toContain('"projx.local/go/ent/product"');
    expect(adapter).toContain('entities.Querier');
    expect(adapter).toContain(
      'func NewQuerier(client *ent.Client) entities.Querier',
    );
    expect(adapter).toContain(
      'func Config(client *ent.Client) entities.EntityConfig',
    );
    expect(adapter).toContain('Name:             "product",');
    expect(adapter).toContain('BasePath:         "/products",');
    expect(adapter).toContain('SoftDelete:       false,');
  }, 60000);

  it('wires entity import and registration into main.go', async () => {
    dest = join(tmpdir(), `projx-gen-ent-main-${Date.now()}`);
    await scaffold(
      {
        name: 'ent-app',
        components: ['go'],
        orm: 'ent',
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
      /\/\/ projx-anchor: entity-registrations\s*\n\s*entities\.Register\(product\.Config\(handles\.Client\)\)/,
    );
  }, 60000);

  it('is idempotent — gen entity twice produces no duplicate wiring', async () => {
    dest = join(tmpdir(), `projx-gen-ent-idem-${Date.now()}`);
    await scaffold(
      {
        name: 'ent-app',
        components: ['go'],
        orm: 'ent',
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
    const regs = main.match(
      /entities\.Register\(product\.Config\(handles\.Client\)\)/g,
    );
    expect(imports?.length).toBe(1);
    expect(regs?.length).toBe(1);
  }, 60000);

  it('no-soft-delete path emits no deleted_at handling on the generated schema', async () => {
    dest = join(tmpdir(), `projx-gen-ent-no-soft-${Date.now()}`);
    await scaffold(
      {
        name: 'ent-app',
        components: ['go'],
        orm: 'ent',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'product', 'title:string', undefined, REPO_DIR);

    const schema = await readFile(
      join(dest, 'go/ent/schema/product.go'),
      'utf-8',
    );
    expect(schema).not.toContain('SoftDeleteMixin{}');
    expect(schema).not.toContain('deleted_at');

    const adapter = await readFile(
      join(dest, 'go/internal/product/product.go'),
      'utf-8',
    );
    expect(adapter).toContain('SoftDelete:       false,');
    expect(adapter).not.toContain('DeletedAtIsNil()');
  }, 60000);

  it('adapter BulkDelete returns affected count and omits unused-var stubs', async () => {
    dest = join(tmpdir(), `projx-gen-ent-bulk-${Date.now()}`);
    await scaffold(
      {
        name: 'ent-app',
        components: ['go'],
        orm: 'ent',
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
    expect(adapter).toContain('return n, nil');
    expect(adapter).not.toContain('_ = needle');
    expect(adapter).not.toContain('_ = col');
    expect(adapter).not.toContain('_ = val');
  }, 60000);

  it('soft-delete sample schema includes SoftDeleteMixin{} and ships mixins.go', async () => {
    dest = join(tmpdir(), `projx-gen-ent-soft-${Date.now()}`);
    await scaffold(
      {
        name: 'ent-app',
        components: ['go'],
        orm: 'ent',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const post = await readFile(join(dest, 'go/ent/schema/post.go'), 'utf-8');
    expect(post).toMatch(
      /func\s+\(Post\)\s+Mixin\(\)\s+\[\]ent\.Mixin\s*{\s*return\s+\[\]ent\.Mixin\s*{[\s\S]*SoftDeleteMixin{},[\s\S]*}/,
    );

    const mixinsPath = join(dest, 'go/ent/schema/mixins.go');
    expect(existsSync(mixinsPath)).toBe(true);
    const mixins = await readFile(mixinsPath, 'utf-8');
    expect(mixins).toContain('type SoftDeleteMixin struct');
    expect(mixins).toContain('func (SoftDeleteMixin) Fields() []ent.Field');
  }, 60000);

  it('uses SetNillable + pointer create-input for ?-suffixed fields', async () => {
    dest = join(tmpdir(), `projx-gen-ent-opt-${Date.now()}`);
    await scaffold(
      {
        name: 'ent-app',
        components: ['go'],
        orm: 'ent',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      'invoice',
      'title:string,note?:text,qty?:number,active?:boolean',
      undefined,
      REPO_DIR,
    );

    const adapter = await readFile(
      join(dest, 'go/internal/invoice/invoice.go'),
      'utf-8',
    );
    expect(adapter).toContain('SetTitle(in.Title)');
    expect(adapter).toContain('SetNillableNote(in.Note)');
    expect(adapter).toContain('SetNillableQty(in.Qty)');
    expect(adapter).toContain('SetNillableActive(in.Active)');
    expect(adapter).toMatch(/Note\s+\*string/);
    expect(adapter).toMatch(/Qty\s+\*int/);
  }, 60000);

  it('decodes date create-input via entities.JSONTime and converts at the setter', async () => {
    dest = join(tmpdir(), `projx-gen-ent-date-${Date.now()}`);
    await scaffold(
      {
        name: 'ent-app',
        components: ['go'],
        orm: 'ent',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      'invoice',
      'title:string,due:date,seen?:datetime,meta:json',
      undefined,
      REPO_DIR,
    );

    const adapter = await readFile(
      join(dest, 'go/internal/invoice/invoice.go'),
      'utf-8',
    );
    expect(adapter).toMatch(/Due\s+entities\.JSONTime\s+`json:"due"`/);
    expect(adapter).toMatch(/Seen\s+\*entities\.JSONTime\s+`json:"seen"`/);
    expect(adapter).toContain('SetDue(in.Due.Time)');
    expect(adapter).toContain('SetNillableSeen(in.Seen.TimePtr())');
    expect(adapter).toContain('entities.ParseTime(s)');
    expect(adapter).toContain('if m, ok := v.(map[string]any); ok {');
  }, 60000);
});
