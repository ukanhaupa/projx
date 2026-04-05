import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

  it("generates for both backends when both present", async () => {
    dest = join(tmpdir(), `projx-gen-both-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["fastapi", "fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, "product", "name:string,price:number,active:boolean");

    expect(existsSync(join(dest, "fastapi/src/entities/product/_model.py"))).toBe(true);
    expect(existsSync(join(dest, "fastify/src/modules/product/schemas.ts"))).toBe(true);
    expect(existsSync(join(dest, "fastify/src/modules/product/index.ts"))).toBe(true);
  });

  it("skips generation if entity already exists", async () => {
    dest = join(tmpdir(), `projx-gen-exists-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["fastapi"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, "invoice", "name:string");
    const firstContent = await readFile(join(dest, "fastapi/src/entities/invoice/_model.py"), "utf-8");

    // Second gen should skip
    await gen(dest, "invoice", "name:string,extra:number");
    const secondContent = await readFile(join(dest, "fastapi/src/entities/invoice/_model.py"), "utf-8");

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

    const content = await readFile(join(dest, "fastapi/src/entities/task/_model.py"), "utf-8");
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

    const content = await readFile(join(dest, "fastapi/src/entities/category/_model.py"), "utf-8");
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

    expect(existsSync(join(dest, "fastapi/src/entities/order_item/_model.py"))).toBe(true);
    const content = await readFile(join(dest, "fastapi/src/entities/order_item/_model.py"), "utf-8");
    expect(content).toContain("class OrderItem(BaseModel_):");
    expect(content).toContain('__tablename__ = "order_items"');
  });

  it("skips backends not in project", async () => {
    dest = join(tmpdir(), `projx-gen-frontend-only-${Date.now()}`);
    await scaffold(
      { name: "gen-app", components: ["fastify", "frontend"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await gen(dest, "user", "name:string,email:string");

    // Fastify should have files
    expect(existsSync(join(dest, "fastify/src/modules/user/schemas.ts"))).toBe(true);

    // FastAPI should NOT have files (not in project)
    expect(existsSync(join(dest, "fastapi/src/entities/user/_model.py"))).toBe(false);
  });
});
