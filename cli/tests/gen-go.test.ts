import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from '../src/scaffold.js';
import { gen } from '../src/gen.js';

const REPO_DIR = join(import.meta.dirname, '../..');

describe('gen entity (go)', () => {
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

  it('generates a Go entity file at internal/<entity>/<entity>.go with correct model + Config', async () => {
    dest = join(tmpdir(), `projx-gen-go-${Date.now()}`);
    await scaffold(
      { name: 'gen-app', components: ['go'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'invoice', 'title:string,amount:number,paid:boolean');

    const modelPath = join(dest, 'go/internal/invoice/invoice.go');
    expect(existsSync(modelPath)).toBe(true);

    const content = await readFile(modelPath, 'utf-8');
    expect(content).toContain('package invoice');
    expect(content).toContain('"projx.local/go/internal/entities"');
    expect(content).toContain('"projx.local/go/internal/uuid"');
    expect(content).toContain('type Invoice struct {');
    expect(content).toContain(
      'ID        string    `gorm:"primaryKey;type:uuid" json:"id"`',
    );
    expect(content).toMatch(/Title\s+string\s+`gorm:"not null" json:"title"`/);
    expect(content).toMatch(/Amount\s+int\s+`gorm:"not null" json:"amount"`/);
    expect(content).toMatch(/Paid\s+bool\s+`gorm:"not null" json:"paid"`/);
    expect(content).toContain('CreatedAt');
    expect(content).toContain('UpdatedAt');
    expect(content).toContain(
      'func (m *Invoice) BeforeCreate(_ *gorm.DB) error',
    );
    expect(content).toContain('m.ID = uuid.V4()');
    expect(content).toContain('func Config() entities.EntityConfig {');
    expect(content).toContain('Name:             "invoice",');
    expect(content).toContain('Model:            &Invoice{},');
    expect(content).toContain('BasePath:         "/invoices",');
    expect(content).toContain('SearchableFields: []string{"title"},');
    expect(content).toContain('SoftDelete:       false,');
  });

  it('generates a smoke test file alongside the model', async () => {
    dest = join(tmpdir(), `projx-gen-go-test-${Date.now()}`);
    await scaffold(
      { name: 'gen-app', components: ['go'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'invoice', 'title:string,amount:number');

    const testPath = join(dest, 'go/internal/invoice/invoice_test.go');
    expect(existsSync(testPath)).toBe(true);

    const content = await readFile(testPath, 'utf-8');
    expect(content).toContain('package invoice');
    expect(content).toContain('func TestConfigShape(t *testing.T)');
    expect(content).toContain('assert.Equal(t, "invoice", cfg.Name)');
    expect(content).toContain('assert.Equal(t, "/invoices", cfg.BasePath)');
    expect(content).toContain('cfg.Model.(*Invoice)');
    expect(content).toContain('func TestBeforeCreateAssignsIDWhenEmpty');
    expect(content).toContain('func TestBeforeCreatePreservesExistingID');
  });

  it('inserts the entity import at the projx-anchor: entity-imports anchor in main.go', async () => {
    dest = join(tmpdir(), `projx-gen-go-imports-${Date.now()}`);
    await scaffold(
      { name: 'gen-app', components: ['go'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'invoice', 'title:string');

    const main = await readFile(join(dest, 'go/main.go'), 'utf-8');
    expect(main).toMatch(
      /\/\/ projx-anchor: entity-imports\s*\n\s*"projx\.local\/go\/internal\/invoice"/,
    );
  });

  it('inserts entities.Register at the projx-anchor: entity-registrations anchor in main.go', async () => {
    dest = join(tmpdir(), `projx-gen-go-reg-${Date.now()}`);
    await scaffold(
      { name: 'gen-app', components: ['go'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'invoice', 'title:string');

    const main = await readFile(join(dest, 'go/main.go'), 'utf-8');
    expect(main).toMatch(
      /\/\/ projx-anchor: entity-registrations\s*\n\s*entities\.Register\(invoice\.Config\(\)\)/,
    );
  });

  it('is idempotent — running gen twice does not duplicate imports or registrations', async () => {
    dest = join(tmpdir(), `projx-gen-go-idem-${Date.now()}`);
    await scaffold(
      { name: 'gen-app', components: ['go'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'invoice', 'title:string');
    await gen(dest, 'invoice', 'title:string');

    const main = await readFile(join(dest, 'go/main.go'), 'utf-8');
    const importMatches = main.match(/"projx\.local\/go\/internal\/invoice"/g);
    const regMatches = main.match(/entities\.Register\(invoice\.Config\(\)\)/g);
    expect(importMatches?.length).toBe(1);
    expect(regMatches?.length).toBe(1);
  });

  it('reads the module path from go.mod and uses it in generated imports', async () => {
    dest = join(tmpdir(), `projx-gen-go-mod-${Date.now()}`);
    await scaffold(
      { name: 'gen-app', components: ['go'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const goModPath = join(dest, 'go/go.mod');
    const original = await readFile(goModPath, 'utf-8');
    const customMod = 'github.com/acme/widgets';
    await writeFile(
      goModPath,
      original.replace(/^module\s+\S+/m, `module ${customMod}`),
    );

    await gen(dest, 'invoice', 'title:string');

    const model = await readFile(
      join(dest, 'go/internal/invoice/invoice.go'),
      'utf-8',
    );
    expect(model).toContain(`"${customMod}/internal/entities"`);
    expect(model).toContain(`"${customMod}/internal/uuid"`);
    expect(model).not.toContain('"projx.local/go/internal/entities"');

    const main = await readFile(join(dest, 'go/main.go'), 'utf-8');
    expect(main).toContain(`"${customMod}/internal/invoice"`);
  });

  it('emits soft-delete column when configured (via prompts default omitted; verified by template)', async () => {
    dest = join(tmpdir(), `projx-gen-go-no-soft-${Date.now()}`);
    await scaffold(
      { name: 'gen-app', components: ['go'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'task', 'title:string');

    const model = await readFile(
      join(dest, 'go/internal/task/task.go'),
      'utf-8',
    );
    expect(model).not.toContain('gorm.DeletedAt');
    expect(model).toContain('SoftDelete:       false,');
  });

  it('uses json.RawMessage for json fields and includes encoding/json import', async () => {
    dest = join(tmpdir(), `projx-gen-go-json-${Date.now()}`);
    await scaffold(
      { name: 'gen-app', components: ['go'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'event', 'name:string,payload:json');

    const model = await readFile(
      join(dest, 'go/internal/event/event.go'),
      'utf-8',
    );
    expect(model).toContain('"encoding/json"');
    expect(model).toMatch(/Payload\s+json\.RawMessage/);
  });

  it('coexists with a Node backend — both get the entity', async () => {
    dest = join(tmpdir(), `projx-gen-go-and-fastify-${Date.now()}`);
    await scaffold(
      {
        name: 'gen-app',
        components: ['go', 'fastify'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'invoice', 'title:string,amount:number');

    expect(existsSync(join(dest, 'go/internal/invoice/invoice.go'))).toBe(true);
    expect(
      existsSync(join(dest, 'fastify/src/modules/invoice/schemas.ts')),
    ).toBe(true);
  });

  it('renders ?-suffixed gorm fields with json omitempty and no not-null tag', async () => {
    dest = join(tmpdir(), `projx-gen-go-opt-${Date.now()}`);
    await scaffold(
      { name: 'gen-app', components: ['go'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'invoice', 'title:string,note?:text,qty?:number');

    const content = await readFile(
      join(dest, 'go/internal/invoice/invoice.go'),
      'utf-8',
    );
    expect(content).toMatch(/Title\s+string\s+`gorm:"not null" json:"title"`/);
    expect(content).toMatch(/Note\s+string\s+`json:"note,omitempty"`/);
    expect(content).toMatch(/Qty\s+int\s+`json:"qty,omitempty"`/);
  });

  it('types gorm date/datetime model fields as entities.JSONTime', async () => {
    dest = join(tmpdir(), `projx-gen-go-date-${Date.now()}`);
    await scaffold(
      { name: 'gen-app', components: ['go'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'invoice', 'title:string,due:date,seen?:datetime');

    const content = await readFile(
      join(dest, 'go/internal/invoice/invoice.go'),
      'utf-8',
    );
    expect(content).toMatch(/Due\s+entities\.JSONTime\s+`gorm:"not null"/);
    expect(content).toMatch(
      /Seen\s+entities\.JSONTime\s+`json:"seen,omitempty"`/,
    );
    expect(content).not.toMatch(/Due\s+time\.Time/);
  });
});
