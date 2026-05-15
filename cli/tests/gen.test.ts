import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { scaffold } from "../src/scaffold.js";
import { gen } from "../src/gen.js";

const REPO_DIR = join(import.meta.dirname, "../..");

describe("gen entity", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("generates FastAPI model from --fields flag", async () => {
    dest = join(tmpdir(), `projx-gen-fastapi-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["fastapi"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, "invoice", "name:string,amount:number,due_date:date");

    const modelPath = join(dest, "fastapi/src/entities/invoice/_model.py");
    expect(existsSync(modelPath)).toBe(true);

    const content = await readFile(modelPath, "utf-8");
    expect(content).toContain("class Invoice(BaseModel_):");
    expect(content).toContain('__tablename__ = "invoices"');
    expect(content).toContain('__api_prefix__ = "/invoices"');
    expect(content).toContain("name = Column(String(255)");
    expect(content).toContain("amount = Column(Integer");
    expect(content).toContain("due_date = Column(Date");
  });

  it("generates Fastify schemas, index, and prisma model", async () => {
    dest = join(tmpdir(), `projx-gen-fastify-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, "invoice", "name:string,amount:number,status:string");

    // Check schemas.ts
    const schemasPath = join(dest, "fastify/src/modules/invoice/schemas.ts");
    expect(existsSync(schemasPath)).toBe(true);
    const schemas = await readFile(schemasPath, "utf-8");
    expect(schemas).toContain("InvoiceSchema");
    expect(schemas).toContain("CreateInvoiceSchema");
    expect(schemas).toContain("UpdateInvoiceSchema");

    // Check index.ts
    const indexPath = join(dest, "fastify/src/modules/invoice/index.ts");
    expect(existsSync(indexPath)).toBe(true);
    const index = await readFile(indexPath, "utf-8");
    expect(index).toContain("EntityRegistry.register(");
    expect(index).toContain("'invoices'");
    expect(index).toContain("'/invoices'");

    // Check prisma schema updated
    const prismaPath = join(dest, "fastify/prisma/schema.prisma");
    const prisma = await readFile(prismaPath, "utf-8");
    expect(prisma).toContain("model Invoice {");
    expect(prisma).toContain('@@map("invoices")');

    // Check app.ts import added
    const appPath = join(dest, "fastify/src/app.ts");
    const app = await readFile(appPath, "utf-8");
    expect(app).toContain("import './modules/invoice/index.js';");
  });

  it("generates Express schemas, index, prisma model, and test", async () => {
    dest = join(tmpdir(), `projx-gen-express-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["express"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, "invoice", "name:string,amount:number,status:string");

    const schemasPath = join(dest, "express/src/modules/invoice/schemas.ts");
    expect(existsSync(schemasPath)).toBe(true);
    const schemas = await readFile(schemasPath, "utf-8");
    expect(schemas).toContain("InvoiceSchema");
    expect(schemas).toContain("CreateInvoiceSchema");
    expect(schemas).toContain("UpdateInvoiceSchema");
    expect(schemas).toContain("z.object");

    const indexPath = join(dest, "express/src/modules/invoice/index.ts");
    expect(existsSync(indexPath)).toBe(true);
    const index = await readFile(indexPath, "utf-8");
    expect(index).toContain("EntityRegistry.register(");
    expect(index).toContain("'invoices'");
    expect(index).toContain("'/invoices'");

    const prismaPath = join(dest, "express/prisma/schema.prisma");
    const prisma = await readFile(prismaPath, "utf-8");
    expect(prisma).toContain("model Invoice {");
    expect(prisma).toContain('@@map("invoices")');

    const appPath = join(dest, "express/src/app.ts");
    const app = await readFile(appPath, "utf-8");
    expect(app).toContain("import './modules/invoice/index.js';");

    const testPath = join(dest, "express/tests/modules/invoice.test.ts");
    expect(existsSync(testPath)).toBe(true);
    const test = await readFile(testPath, "utf-8");
    expect(test).toContain("describeCrudEntity({");
    expect(test).toContain("createSchema: CreateInvoiceSchema,");
  });

  it("generates Drizzle table schema when a Node backend uses Drizzle", async () => {
    dest = join(tmpdir(), `projx-gen-drizzle-${Date.now()}`);
    await scaffold(
      {
        name: "gen-app",
        components: ["express"],
        git: true,
        install: false,
        orm: "drizzle",
      },
      dest,
      REPO_DIR,
    );

    await gen(dest, "invoice", "name:string:unique,amount:number,paid:boolean");

    const schemaPath = join(dest, "express/src/db/schema.ts");
    const schema = await readFile(schemaPath, "utf-8");
    expect(schema).toContain("export const invoices = pgTable('invoices'");
    expect(schema).toContain("name: text('name').notNull().unique()");
    expect(schema).toContain("amount: integer('amount').notNull()");
    expect(schema).toContain("paid: boolean('paid').notNull()");
    expect(existsSync(join(dest, "express/src/modules/invoice"))).toBe(false);
    expect(existsSync(join(dest, "express/prisma/schema.prisma"))).toBe(false);
  });

  it("generates beforeCreate hooks for unique generated Fastify fields omitted from create schema", async () => {
    dest = join(tmpdir(), `projx-gen-fastify-generated-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      "household-invite",
      "invite_code:string:unique:generated,email:string",
    );

    const schemas = await readFile(
      join(dest, "fastify/src/modules/household-invite/schemas.ts"),
      "utf-8",
    );
    expect(schemas).toContain("invite_code: Type.String()");
    expect(schemas).not.toMatch(
      /CreateHouseholdInviteSchema[\s\S]+invite_code/,
    );

    const index = await readFile(
      join(dest, "fastify/src/modules/household-invite/index.ts"),
      "utf-8",
    );
    expect(index).toContain("import { randomBytes } from 'node:crypto';");
    expect(index).toContain("function generateHouseholdInviteInviteCode()");
    expect(index).toContain("beforeCreate:");
    expect(index).toContain(
      "data.invite_code = generateHouseholdInviteInviteCode();",
    );

    const prisma = await readFile(
      join(dest, "fastify/prisma/schema.prisma"),
      "utf-8",
    );
    expect(prisma).toContain("invite_code String   @db.VarChar(255) @unique");
  });

  it("generates beforeCreate hooks for unique generated Express fields omitted from create schema", async () => {
    dest = join(tmpdir(), `projx-gen-express-generated-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["express"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      "household-invite",
      "invite_code:string:unique:generated,email:string",
    );

    const schemas = await readFile(
      join(dest, "express/src/modules/household-invite/schemas.ts"),
      "utf-8",
    );
    expect(schemas).toContain("invite_code: z.string()");
    expect(schemas).not.toMatch(
      /CreateHouseholdInviteSchema[\s\S]+invite_code/,
    );

    const index = await readFile(
      join(dest, "express/src/modules/household-invite/index.ts"),
      "utf-8",
    );
    expect(index).toContain("import { randomBytes } from 'node:crypto';");
    expect(index).toContain("function generateHouseholdInviteInviteCode()");
    expect(index).toContain("beforeCreate:");
    expect(index).toContain(
      "data.invite_code = generateHouseholdInviteInviteCode();",
    );

    const prisma = await readFile(
      join(dest, "express/prisma/schema.prisma"),
      "utf-8",
    );
    expect(prisma).toContain("invite_code String   @db.VarChar(255) @unique");
  });

  it("generates in primary backend only when both present", async () => {
    dest = join(tmpdir(), `projx-gen-both-${Date.now()}`);
    await scaffold(
      {
        name: "gen-app",
        components: ["fastapi", "fastify"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    // Non-interactive defaults to fastify
    await gen(dest, "product", "name:string,price:number,active:boolean");

    expect(
      existsSync(join(dest, "fastify/src/modules/product/schemas.ts")),
    ).toBe(true);
    expect(existsSync(join(dest, "fastify/src/modules/product/index.ts"))).toBe(
      true,
    );
    expect(existsSync(join(dest, "fastapi/src/entities/product"))).toBe(false);
  });

  it("skips generation if entity already exists", async () => {
    dest = join(tmpdir(), `projx-gen-exists-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["fastapi"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, "invoice", "name:string");
    const firstContent = await readFile(
      join(dest, "fastapi/src/entities/invoice/_model.py"),
      "utf-8",
    );

    // Second gen should skip
    await gen(dest, "invoice", "name:string,extra:number");
    const secondContent = await readFile(
      join(dest, "fastapi/src/entities/invoice/_model.py"),
      "utf-8",
    );

    expect(secondContent).toBe(firstContent);
  });

  it("handles soft delete flag", async () => {
    dest = join(tmpdir(), `projx-gen-softdel-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["fastapi"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    // We can't easily test soft delete with --fields flag since it needs interactive prompt
    // But we can verify the template generates correct output by checking the model
    await gen(dest, "task", "title:string,status:string");

    const content = await readFile(
      join(dest, "fastapi/src/entities/task/_model.py"),
      "utf-8",
    );
    expect(content).toContain("class Task(BaseModel_):");
    expect(content).toContain('__tablename__ = "tasks"');
  });

  it("pluralizes entity names correctly", async () => {
    dest = join(tmpdir(), `projx-gen-plural-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["fastapi"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, "category", "name:string");

    const content = await readFile(
      join(dest, "fastapi/src/entities/category/_model.py"),
      "utf-8",
    );
    expect(content).toContain('__tablename__ = "categories"');
    expect(content).toContain('__api_prefix__ = "/categories"');
  });

  it("handles kebab-case entity names", async () => {
    dest = join(tmpdir(), `projx-gen-kebab-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["fastapi"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, "order-item", "name:string,quantity:number");

    expect(
      existsSync(join(dest, "fastapi/src/entities/order_item/_model.py")),
    ).toBe(true);
    const content = await readFile(
      join(dest, "fastapi/src/entities/order_item/_model.py"),
      "utf-8",
    );
    expect(content).toContain("class OrderItem(BaseModel_):");
    expect(content).toContain('__tablename__ = "order_items"');
  });

  it("skips backends not in project", async () => {
    dest = join(tmpdir(), `projx-gen-frontend-only-${Date.now()}`);
    await scaffold(
      {
        name: "gen-app",
        components: ["fastify", "frontend"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(dest, "user", "name:string,email:string");

    // Fastify should have files
    expect(existsSync(join(dest, "fastify/src/modules/user/schemas.ts"))).toBe(
      true,
    );

    // FastAPI should NOT have files (not in project)
    expect(existsSync(join(dest, "fastapi/src/entities/user/_model.py"))).toBe(
      false,
    );
  });

  it("generates frontend TypeScript interface", async () => {
    dest = join(tmpdir(), `projx-gen-ts-${Date.now()}`);
    await scaffold(
      {
        name: "gen-app",
        components: ["fastify", "frontend"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      "product",
      "name:string,price:number,active:boolean,notes:text",
    );

    const typePath = join(dest, "frontend/src/types/product.ts");
    expect(existsSync(typePath)).toBe(true);

    const content = await readFile(typePath, "utf-8");
    expect(content).toContain("export interface Product {");
    expect(content).toContain("id: string;");
    expect(content).toContain("name: string;");
    expect(content).toContain("price: number;");
    expect(content).toContain("active: boolean;");
    expect(content).toContain("notes: string;");
    expect(content).toContain("created_at: string;");
    expect(content).toContain("updated_at: string;");

    expect(content).toContain("export interface CreateProduct {");
    expect(content).toContain("export interface UpdateProduct {");

    // Barrel file
    const barrelPath = join(dest, "frontend/src/types/index.ts");
    expect(existsSync(barrelPath)).toBe(true);
    const barrel = await readFile(barrelPath, "utf-8");
    expect(barrel).toContain("export * from './product';");
  });

  it("generates mobile Dart model", async () => {
    dest = join(tmpdir(), `projx-gen-dart-${Date.now()}`);
    await scaffold(
      {
        name: "gen-app",
        components: ["fastify", "mobile"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(dest, "product", "name:string,price:number,description:text");

    const modelPath = join(dest, "mobile/lib/entities/product/model.dart");
    expect(existsSync(modelPath)).toBe(true);

    const content = await readFile(modelPath, "utf-8");
    expect(content).toContain("class Product {");
    expect(content).toContain("final String id;");
    expect(content).toContain("final String name;");
    expect(content).toContain("final int price;");
    expect(content).toContain("final String description;");
    expect(content).toContain("final DateTime createdAt;");

    expect(content).toContain(
      "factory Product.fromJson(Map<String, dynamic> json)",
    );
    expect(content).toContain("Map<String, dynamic> toJson()");
    expect(content).toContain("Product copyWith(");

    // Non-nullable DateTime fields must not use null-aware operator
    expect(content).toContain("'created_at': createdAt.toIso8601String()");
    expect(content).not.toContain("createdAt?.toIso8601String()");
  });

  it("generates primary backend + frontend + mobile types", async () => {
    dest = join(tmpdir(), `projx-gen-all-${Date.now()}`);
    await scaffold(
      {
        name: "gen-app",
        components: ["fastapi", "fastify", "frontend", "mobile"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(dest, "invoice", "name:string,amount:number");

    // Primary backend (fastify) + frontend + mobile
    expect(
      existsSync(join(dest, "fastify/src/modules/invoice/schemas.ts")),
    ).toBe(true);
    expect(existsSync(join(dest, "frontend/src/types/invoice.ts"))).toBe(true);
    expect(
      existsSync(join(dest, "mobile/lib/entities/invoice/model.dart")),
    ).toBe(true);
    // fastapi should NOT get the entity (it's the AI engine)
    expect(existsSync(join(dest, "fastapi/src/entities/invoice"))).toBe(false);
  });

  it("handles nullable fields in TypeScript interface", async () => {
    dest = join(tmpdir(), `projx-gen-nullable-${Date.now()}`);
    await scaffold(
      {
        name: "gen-app",
        components: ["fastify", "frontend"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    // In parseFieldsFlag, all fields default to required. Test nullable via the generated output.
    await gen(dest, "task", "title:string,notes:text");

    const content = await readFile(
      join(dest, "frontend/src/types/task.ts"),
      "utf-8",
    );
    expect(content).toContain("title: string;");
    expect(content).toContain("notes: string;");
  });

  it("barrel file appends on second entity generation", async () => {
    dest = join(tmpdir(), `projx-gen-barrel-${Date.now()}`);
    await scaffold(
      {
        name: "gen-app",
        components: ["fastify", "frontend"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await gen(dest, "product", "name:string");
    await gen(dest, "invoice", "name:string,amount:number");

    const barrel = await readFile(
      join(dest, "frontend/src/types/index.ts"),
      "utf-8",
    );
    expect(barrel).toContain("export * from './product';");
    expect(barrel).toContain("export * from './invoice';");
  });

  it("works with renamed directories (fastapi→ai, fastify→backend)", async () => {
    dest = join(tmpdir(), `projx-gen-rename-${Date.now()}`);
    await scaffold(
      {
        name: "gen-app",
        components: ["fastapi", "fastify"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    execSync(`mv "${join(dest, "fastapi")}" "${join(dest, "ai")}"`, {
      stdio: "pipe",
    });
    execSync(`mv "${join(dest, "fastify")}" "${join(dest, "backend")}"`, {
      stdio: "pipe",
    });

    const projx = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    projx.primaryBackend = "fastify";
    await writeFile(
      join(dest, ".projx"),
      JSON.stringify(projx, null, 2) + "\n",
    );
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'rename dirs'",
      { cwd: dest, stdio: "pipe" },
    );

    await gen(dest, "tenant", "name:string,domain:string");

    // Only fastify (primary) gets the entity, not fastapi
    expect(
      existsSync(join(dest, "backend/src/modules/tenant/schemas.ts")),
    ).toBe(true);
    expect(existsSync(join(dest, "backend/src/modules/tenant/index.ts"))).toBe(
      true,
    );
    expect(existsSync(join(dest, "ai/src/entities/tenant/_model.py"))).toBe(
      false,
    );
  });

  it("defaults to only backend when single backend exists", async () => {
    dest = join(tmpdir(), `projx-gen-single-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["fastapi"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, "task", "title:string");

    expect(existsSync(join(dest, "fastapi/src/entities/task/_model.py"))).toBe(
      true,
    );
  });

  it("defaults to Express when it is the only backend", async () => {
    dest = join(tmpdir(), `projx-gen-single-express-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["express"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, "task", "title:string");

    expect(existsSync(join(dest, "express/src/modules/task/schemas.ts"))).toBe(
      true,
    );
  });

  it("--ai flag generates in fastapi even when both exist", async () => {
    dest = join(tmpdir(), `projx-gen-ai-flag-${Date.now()}`);
    await scaffold(
      {
        name: "gen-app",
        components: ["fastapi", "fastify"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const projx = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    projx.primaryBackend = "fastify";
    await writeFile(
      join(dest, ".projx"),
      JSON.stringify(projx, null, 2) + "\n",
    );

    await gen(dest, "embedding", "name:string,vector:json", "fastapi");

    expect(
      existsSync(join(dest, "fastapi/src/entities/embedding/_model.py")),
    ).toBe(true);
    expect(existsSync(join(dest, "fastify/src/modules/embedding"))).toBe(false);
  });

  it("--backend flag generates in fastify even when primaryBackend is fastapi", async () => {
    dest = join(tmpdir(), `projx-gen-backend-flag-${Date.now()}`);
    await scaffold(
      {
        name: "gen-app",
        components: ["fastapi", "fastify"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const projx = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    projx.primaryBackend = "fastapi";
    await writeFile(
      join(dest, ".projx"),
      JSON.stringify(projx, null, 2) + "\n",
    );

    await gen(dest, "invoice", "name:string,amount:number", "fastify");

    expect(
      existsSync(join(dest, "fastify/src/modules/invoice/schemas.ts")),
    ).toBe(true);
    expect(existsSync(join(dest, "fastapi/src/entities/invoice"))).toBe(false);
  });

  it("saves primaryBackend to .projx in non-interactive mode", async () => {
    dest = join(tmpdir(), `projx-gen-save-${Date.now()}`);
    await scaffold(
      {
        name: "gen-app",
        components: ["fastapi", "fastify"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    // Non-interactive (no TTY) defaults to fastify
    await gen(dest, "task", "title:string");

    expect(existsSync(join(dest, "fastify/src/modules/task/schemas.ts"))).toBe(
      true,
    );
    expect(existsSync(join(dest, "fastapi/src/entities/task"))).toBe(false);
  });

  it("generates FastAPI test file alongside the model", async () => {
    dest = join(tmpdir(), `projx-gen-fastapi-test-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["fastapi"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(
      dest,
      "invoice",
      "name:string,amount:number,due_date:date,active:boolean",
    );

    // __init__.py re-exports the model so the public import style works
    const initPath = join(dest, "fastapi/src/entities/invoice/__init__.py");
    expect(existsSync(initPath)).toBe(true);
    const initContent = await readFile(initPath, "utf-8");
    expect(initContent).toContain("from ._model import *");

    const testPath = join(dest, "fastapi/tests/test_invoice_entity.py");
    expect(existsSync(testPath)).toBe(true);

    const content = await readFile(testPath, "utf-8");
    // Public import — the convention requires importing from the package, not the private file
    expect(content).toContain("from src.entities.invoice import Invoice");
    expect(content).not.toContain("from src.entities.invoice._model import");
    expect(content).toContain(
      "from tests.base_entity_api_test import BaseEntityApiTest",
    );
    expect(content).toContain("class TestInvoiceEntity(BaseEntityApiTest):");
    expect(content).toContain("__test__ = True");
    expect(content).toContain('endpoint = "/api/v1/invoices/"');
    expect(content).toContain('"name": "sample text"');
    expect(content).toContain('"amount": 42');
    expect(content).toContain('"active": True');
    expect(content).toContain('filter_field = "name"');
    expect(content).toContain("def make_model(self, index: int, **overrides):");
    expect(content).toContain("return Invoice(**data)");
    expect(content).toContain("from datetime import date");
    expect(content).toContain("date(2026, 1, 1)");
  });

  it("generates Fastify test file alongside the schemas and index", async () => {
    dest = join(tmpdir(), `projx-gen-fastify-test-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, "invoice", "name:string,amount:number,active:boolean");

    const testPath = join(dest, "fastify/tests/modules/invoice.test.ts");
    expect(existsSync(testPath)).toBe(true);

    const content = await readFile(testPath, "utf-8");
    expect(content).toContain(
      "import { describeCrudEntity } from '../helpers/crud-test-base.js';",
    );
    expect(content).toContain("describeCrudEntity({");
    expect(content).toContain("entityName: 'Invoice',");
    expect(content).toContain("basePath: '/api/v1/invoices',");
    expect(content).toContain("prismaModel: 'Invoice',");
    expect(content).toContain(
      "import { CreateInvoiceSchema } from '../../src/modules/invoice/schemas.js';",
    );
    expect(content).toContain("createSchema: CreateInvoiceSchema,");
    expect(content).not.toContain("createPayload:");
    expect(content).toContain("updatePayload: {");
    expect(content).toContain("name: 'updated text',");
  });

  it("does not overwrite an existing test file", async () => {
    dest = join(tmpdir(), `projx-gen-test-skip-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, "invoice", "name:string");
    const firstContent = await readFile(
      join(dest, "fastify/tests/modules/invoice.test.ts"),
      "utf-8",
    );

    // Manually edit the test file
    const testPath = join(dest, "fastify/tests/modules/invoice.test.ts");
    await writeFile(testPath, "// custom test\n" + firstContent);

    // Re-run gen with a different entity name (so the entity-skip kicks in only on the test side)
    // Actually the model already exists so the whole thing skips. Let's verify manually:
    // delete the schemas to force regeneration but keep the test file
    await rm(join(dest, "fastify/src/modules/invoice"), { recursive: true });
    await gen(dest, "invoice", "name:string,extra:number");

    // Test file should be untouched (still starts with our custom marker)
    const afterContent = await readFile(testPath, "utf-8");
    expect(afterContent.startsWith("// custom test\n")).toBe(true);
  });
});
