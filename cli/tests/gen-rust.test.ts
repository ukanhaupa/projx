import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from '../src/scaffold.js';
import { gen } from '../src/gen.js';

const REPO_DIR = join(import.meta.dirname, '../..');

describe('gen entity (rust / seaorm)', () => {
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

  it('generates a SeaORM module at src/<entity>/mod.rs with Model, handler, and config', async () => {
    dest = join(tmpdir(), `projx-gen-rust-${Date.now()}`);
    await scaffold(
      {
        name: 'gen-app',
        components: ['rust'],
        git: true,
        install: false,
        orm: 'seaorm',
      },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      'invoice',
      'title:string,amount:number,paid:boolean,due:date,meta:json',
      undefined,
      REPO_DIR,
    );

    const modPath = join(dest, 'rust/src/invoice/mod.rs');
    expect(existsSync(modPath)).toBe(true);

    const content = await readFile(modPath, 'utf-8');
    expect(content).toContain('#[sea_orm(table_name = "invoices")]');
    expect(content).toContain('pub struct Model {');
    expect(content).toContain('pub id: Uuid,');
    expect(content).toContain('pub title: String,');
    expect(content).toContain('pub amount: i64,');
    expect(content).toContain('pub paid: bool,');
    expect(content).toContain('pub due: DateTime<Utc>,');
    expect(content).toContain('pub meta: Value,');
    expect(content).toContain('pub created_at: DateTime<Utc>,');
    expect(content).toContain('pub updated_at: DateTime<Utc>,');
    expect(content).toContain('pub deleted_at: Option<DateTime<Utc>>,');
    expect(content).toContain('pub struct InvoiceHandler;');
    expect(content).toContain('impl EntityHandler for InvoiceHandler {');
    expect(content).toContain('pub fn config() -> EntityConfig {');
    expect(content).toContain('name: "invoice",');
    expect(content).toContain('base_path: "/invoices",');
    expect(content).toContain('handler: Arc::new(InvoiceHandler),');
    expect(content).toContain('hidden_fields: vec!["deleted_at"],');
    expect(content).not.toContain('undefined');
    expect(content).toContain('.and_then(|v| v.as_i64())');
    expect(content).toContain('.and_then(|v| v.as_bool())');
    expect(content).toContain('am.amount = Set(n);');
    expect(content).toContain('DateTime::parse_from_rfc3339(s)');
  });

  it('normalizes alias field types (float/int/bool) and rejects unknown types', async () => {
    dest = join(tmpdir(), `projx-gen-rust-alias-${Date.now()}`);
    await scaffold(
      {
        name: 'gen-app',
        components: ['rust'],
        git: true,
        install: false,
        orm: 'seaorm',
      },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      'product',
      'title:string,price:float,qty:int,active:bool',
      undefined,
      REPO_DIR,
    );

    const content = await readFile(
      join(dest, 'rust/src/product/mod.rs'),
      'utf-8',
    );
    expect(content).not.toContain('undefined');
    expect(content).toContain('pub price: i64,');
    expect(content).toContain('pub qty: i64,');
    expect(content).toContain('pub active: bool,');

    await expect(
      gen(dest, 'broken', 'name:string,weird:frobnicate', undefined, REPO_DIR),
    ).rejects.toThrow(/unknown field type "frobnicate"/);
  });

  it('wires the module into lib.rs and main.rs anchors idempotently', async () => {
    dest = join(tmpdir(), `projx-gen-rust-wire-${Date.now()}`);
    await scaffold(
      {
        name: 'gen-app',
        components: ['rust'],
        git: true,
        install: false,
        orm: 'seaorm',
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

    const libPath = join(dest, 'rust/src/lib.rs');
    const mainPath = join(dest, 'rust/src/main.rs');
    const lib = await readFile(libPath, 'utf-8');
    const main = await readFile(mainPath, 'utf-8');

    expect(lib).toContain('pub mod invoice;');
    expect(main).toContain('use projx::invoice;');
    expect(main).toContain('projx::entities::register(invoice::config());');

    await gen(
      dest,
      'invoice',
      'title:string,amount:number',
      undefined,
      REPO_DIR,
    );
    const lib2 = await readFile(libPath, 'utf-8');
    const main2 = await readFile(mainPath, 'utf-8');
    expect(lib2.match(/pub mod invoice;/g)?.length).toBe(1);
    expect(main2.match(/invoice::config\(\)/g)?.length).toBe(1);
  });

  it('generates a unit test module asserting Config() shape', async () => {
    dest = join(tmpdir(), `projx-gen-rust-test-${Date.now()}`);
    await scaffold(
      {
        name: 'gen-app',
        components: ['rust'],
        git: true,
        install: false,
        orm: 'seaorm',
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

    const content = await readFile(
      join(dest, 'rust/src/invoice/mod.rs'),
      'utf-8',
    );
    expect(content).toContain('#[cfg(test)]');
    expect(content).toContain('mod tests {');
    expect(content).toContain('fn config_is_well_formed() {');
    expect(content).toContain('assert_eq!(c.name, "invoice");');
    expect(content).toContain('assert_eq!(c.base_path, "/invoices");');
    expect(content).toContain('use sea_orm::{DatabaseBackend, MockDatabase');
  });

  it('marks soft_delete true when requested via the config prompt path', async () => {
    dest = join(tmpdir(), `projx-gen-rust-soft-${Date.now()}`);
    await scaffold(
      {
        name: 'gen-app',
        components: ['rust'],
        git: true,
        install: false,
        orm: 'seaorm',
      },
      dest,
      REPO_DIR,
    );

    await gen(dest, 'widget', 'name:string', undefined, REPO_DIR);

    const content = await readFile(
      join(dest, 'rust/src/widget/mod.rs'),
      'utf-8',
    );
    expect(content).toContain('soft_delete: false,');
    expect(content).toContain('const SEARCHABLE: &[&str] = &["name"];');
  });

  it('renders ?-suffixed fields as Option<T> with matching extraction + update', async () => {
    dest = join(tmpdir(), `projx-gen-rust-opt-${Date.now()}`);
    await scaffold(
      {
        name: 'gen-app',
        components: ['rust'],
        git: true,
        install: false,
        orm: 'seaorm',
      },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      'invoice',
      'title:string,note?:text,qty?:number,active?:boolean,seen?:datetime,extra?:json',
      undefined,
      REPO_DIR,
    );

    const content = await readFile(
      join(dest, 'rust/src/invoice/mod.rs'),
      'utf-8',
    );
    expect(content).not.toContain('undefined');
    expect(content).toContain('pub title: String,');
    expect(content).toContain('pub note: Option<String>,');
    expect(content).toContain('pub qty: Option<i64>,');
    expect(content).toContain('pub active: Option<bool>,');
    expect(content).toContain('pub seen: Option<DateTime<Utc>>,');
    expect(content).toContain('pub extra: Option<Value>,');
    expect(content).toContain(
      'let qty = payload.get("qty").and_then(|v| v.as_i64());',
    );
    expect(content).toContain('am.qty = Set(v.as_i64());');
    expect(content).toContain('let extra = payload.get("extra").cloned();');
  });
});
