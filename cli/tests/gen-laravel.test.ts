import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from '../src/scaffold.js';
import { gen } from '../src/gen.js';

const REPO_DIR = join(import.meta.dirname, '../..');

async function scaffoldLaravel(dest: string): Promise<void> {
  await scaffold(
    {
      name: 'gen-app',
      components: ['laravel'],
      git: true,
      install: false,
      orm: 'eloquent',
    },
    dest,
    REPO_DIR,
  );
}

describe('gen entity (laravel / eloquent)', () => {
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

  it('generates an Eloquent model with fillable, casts, and helper methods', async () => {
    dest = join(tmpdir(), `projx-gen-laravel-${Date.now()}`);
    await scaffoldLaravel(dest);

    await gen(
      dest,
      'invoice',
      'title:string,amount:number,paid:boolean,due:date,meta:json',
      undefined,
      REPO_DIR,
    );

    const modelPath = join(dest, 'laravel/app/Models/Invoice.php');
    expect(existsSync(modelPath)).toBe(true);

    const content = await readFile(modelPath, 'utf-8');
    expect(content).toContain('declare(strict_types=1);');
    expect(content).toContain('final class Invoice extends Model');
    expect(content).toContain('use HasUuids;');
    expect(content).toContain("protected $table = 'invoices';");
    expect(content).toContain(
      "protected $fillable = ['title', 'amount', 'paid', 'due', 'meta'];",
    );
    expect(content).toContain("'amount' => 'integer',");
    expect(content).toContain("'paid' => 'boolean',");
    expect(content).toContain("'due' => 'date',");
    expect(content).toContain("'meta' => 'array',");
    expect(content).toContain(
      'public static function searchableFields(): array',
    );
    expect(content).toContain("return ['title'];");
    expect(content).toContain(
      'public static function updatableColumns(): array',
    );
    expect(content).not.toContain('undefined');
  });

  it('emits type-correct migration columns and rejects unknown field types', async () => {
    dest = join(tmpdir(), `projx-gen-laravel-types-${Date.now()}`);
    await scaffoldLaravel(dest);

    await gen(
      dest,
      'product',
      'title:string,price:float,qty:int,active:bool,due:date,meta:json',
      undefined,
      REPO_DIR,
    );

    const migrationsDir = join(dest, 'laravel/database/migrations');
    const files = await readdir(migrationsDir);
    const created = files.find((f) => f.endsWith('_create_products_table.php'));
    expect(created).toBeDefined();
    const migration = await readFile(join(migrationsDir, created!), 'utf-8');
    expect(migration).not.toContain('undefined');
    expect(migration).toContain("$table->string('title', 255);");
    expect(migration).toContain("$table->bigInteger('price');");
    expect(migration).toContain("$table->bigInteger('qty');");
    expect(migration).toContain("$table->boolean('active');");
    expect(migration).toContain("$table->date('due');");
    expect(migration).toContain("$table->jsonb('meta');");

    await expect(
      gen(dest, 'broken', 'name:string,weird:frobnicate', undefined, REPO_DIR),
    ).rejects.toThrow(/unknown field type "frobnicate"/);
  });

  it('adds SoftDeletes only when soft delete is enabled', async () => {
    dest = join(tmpdir(), `projx-gen-laravel-soft-${Date.now()}`);
    await scaffoldLaravel(dest);

    await gen(dest, 'widget', 'name:string', undefined, REPO_DIR);

    const content = await readFile(
      join(dest, 'laravel/app/Models/Widget.php'),
      'utf-8',
    );
    expect(content).not.toContain('use SoftDeletes;');
    expect(content).toContain("protected $table = 'widgets';");
  });

  it('generates a migration with the next sequential prefix', async () => {
    dest = join(tmpdir(), `projx-gen-laravel-mig-${Date.now()}`);
    await scaffoldLaravel(dest);

    await gen(
      dest,
      'invoice',
      'title:string,amount:number',
      undefined,
      REPO_DIR,
    );

    const migrationsDir = join(dest, 'laravel/database/migrations');
    const files = await readdir(migrationsDir);
    const created = files.find((f) => f.endsWith('_create_invoices_table.php'));
    expect(created).toBeDefined();
    expect(created).toMatch(/^0000_00_00_\d{6}_create_invoices_table\.php$/);

    const content = await readFile(join(migrationsDir, created!), 'utf-8');
    expect(content).toContain("Schema::create('invoices'");
    expect(content).toContain("$table->uuid('id')->primary();");
    expect(content).toContain("$table->string('title', 255);");
    expect(content).toContain("$table->bigInteger('amount');");
    expect(content).toContain('$table->timestamps();');
    expect(content).toContain("Schema::dropIfExists('invoices');");
  });

  it('registers the entity at the provider anchor with a fully-qualified model', async () => {
    dest = join(tmpdir(), `projx-gen-laravel-prov-${Date.now()}`);
    await scaffoldLaravel(dest);

    await gen(
      dest,
      'invoice',
      'title:string,amount:number',
      undefined,
      REPO_DIR,
    );

    const providerPath = join(
      dest,
      'laravel/app/Providers/EntityServiceProvider.php',
    );
    const content = await readFile(providerPath, 'utf-8');
    expect(content).toContain('// projx-anchor: entities');
    expect(content).toContain('$registry->register(new EntityConfig(');
    expect(content).toContain("name: 'invoice',");
    expect(content).toContain('baseClass: \\App\\Models\\Invoice::class,');
    expect(content).toContain(
      'searchableFields: \\App\\Models\\Invoice::searchableFields(),',
    );

    await gen(
      dest,
      'invoice',
      'title:string,amount:number',
      undefined,
      REPO_DIR,
    );
    const content2 = await readFile(providerPath, 'utf-8');
    expect(
      content2.match(/baseClass: \\App\\Models\\Invoice::class,/g)?.length,
    ).toBe(1);
  });

  it('generates a Pest CRUD test for the entity', async () => {
    dest = join(tmpdir(), `projx-gen-laravel-test-${Date.now()}`);
    await scaffoldLaravel(dest);

    await gen(
      dest,
      'invoice',
      'title:string,amount:number',
      undefined,
      REPO_DIR,
    );

    const testPath = join(dest, 'laravel/tests/Feature/InvoiceCrudTest.php');
    expect(existsSync(testPath)).toBe(true);

    const content = await readFile(testPath, 'utf-8');
    expect(content).toContain('declare(strict_types=1);');
    expect(content).toContain('use App\\Models\\Invoice;');
    expect(content).toContain('EntityRegistry::resetInstance();');
    expect(content).toContain('/** @var Tests\\TestCase $this */');
    expect(content).toContain("$this->postJson('/api/v1/invoices'");
    expect(content).toContain('->assertStatus(201);');
    expect(content).toContain('->assertNoContent();');
  });

  it('marks ?-suffixed migration columns nullable and keeps required columns NOT NULL', async () => {
    dest = join(tmpdir(), `projx-gen-laravel-opt-${Date.now()}`);
    await scaffold(
      {
        name: 'gen-app',
        components: ['laravel'],
        git: true,
        install: false,
        orm: 'eloquent',
      },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      'invoice',
      'title:string,note?:text,qty?:number,active?:boolean,seen?:datetime',
      undefined,
      REPO_DIR,
    );

    const migration = (
      await readdir(join(dest, 'laravel/database/migrations'))
    ).find((f) => f.includes('create_invoices_table'));
    const migrationSrc = await readFile(
      join(dest, 'laravel/database/migrations', migration!),
      'utf-8',
    );
    expect(migrationSrc).toContain("$table->string('title', 255);");
    expect(migrationSrc).toContain("$table->text('note')->nullable();");
    expect(migrationSrc).toContain("$table->bigInteger('qty')->nullable();");
    expect(migrationSrc).toContain("$table->boolean('active')->nullable();");
    expect(migrationSrc).not.toContain(
      "$table->string('title', 255)->nullable();",
    );
  });
});
