import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  type Component,
  discoverComponentPaths,
  toKebab,
  toSnake,
  toTitle,
} from "./utils.js";

interface ProjxConfig {
  version: string;
  components: Component[];
}

const FIELD_TYPES = ["string", "number", "boolean", "date", "datetime", "text", "json"] as const;
type FieldType = (typeof FIELD_TYPES)[number];

interface EntityField {
  name: string;
  type: FieldType;
  required: boolean;
}

interface EntityConfig {
  name: string;
  tableName: string;
  apiPrefix: string;
  readonly: boolean;
  softDelete: boolean;
  bulkOperations: boolean;
  fields: EntityField[];
  searchableFields: string[];
}

function toPascal(s: string): string {
  return s
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function pluralize(s: string): string {
  if (s.endsWith("s") || s.endsWith("x") || s.endsWith("z") || s.endsWith("sh") || s.endsWith("ch")) return s + "es";
  if (s.endsWith("y") && !/[aeiou]y$/i.test(s)) return s.slice(0, -1) + "ies";
  return s + "s";
}

async function promptEntityConfig(name: string): Promise<EntityConfig> {
  const snake = toSnake(name);
  const tableName = pluralize(snake);
  const kebab = toKebab(name);
  const apiPrefix = "/" + pluralize(kebab);

  const tbl = (await p.text({
    message: "Table name",
    placeholder: tableName,
    defaultValue: tableName,
  })) as string;
  if (p.isCancel(tbl)) process.exit(0);

  const prefix = (await p.text({
    message: "API prefix",
    placeholder: apiPrefix,
    defaultValue: apiPrefix,
  })) as string;
  if (p.isCancel(prefix)) process.exit(0);

  const readonly = (await p.confirm({
    message: "Readonly?",
    initialValue: false,
  })) as boolean;
  if (p.isCancel(readonly)) process.exit(0);

  const softDelete = (await p.confirm({
    message: "Soft delete?",
    initialValue: false,
  })) as boolean;
  if (p.isCancel(softDelete)) process.exit(0);

  const bulk = (await p.confirm({
    message: "Bulk operations?",
    initialValue: true,
  })) as boolean;
  if (p.isCancel(bulk)) process.exit(0);

  // Field prompts
  const fields: EntityField[] = [];
  p.log.info("Define fields (enter empty name to finish):");

  while (true) {
    const fieldName = (await p.text({
      message: `Field ${fields.length + 1} name`,
      placeholder: "done",
      defaultValue: "",
    })) as string;
    if (p.isCancel(fieldName)) process.exit(0);
    if (!fieldName) break;

    const fieldType = (await p.select({
      message: `${fieldName} type`,
      options: FIELD_TYPES.map((t) => ({ value: t, label: t })),
      initialValue: "string" as FieldType,
    })) as FieldType;
    if (p.isCancel(fieldType)) process.exit(0);

    const required = (await p.confirm({
      message: `${fieldName} required?`,
      initialValue: true,
    })) as boolean;
    if (p.isCancel(required)) process.exit(0);

    fields.push({ name: toSnake(fieldName), type: fieldType, required });
  }

  if (fields.length === 0) {
    p.log.warn("No fields defined. Adding a default 'name' field.");
    fields.push({ name: "name", type: "string", required: true });
  }

  // Searchable fields
  const stringFields = fields.filter((f) => f.type === "string" || f.type === "text");
  let searchableFields: string[] = [];

  if (stringFields.length > 0) {
    const selected = (await p.multiselect({
      message: "Searchable fields",
      options: stringFields.map((f) => ({ value: f.name, label: f.name })),
      required: false,
    })) as string[] | symbol;

    if (!p.isCancel(selected)) {
      searchableFields = selected as string[];
    }
  }

  return {
    name,
    tableName: tbl,
    apiPrefix: prefix.startsWith("/") ? prefix : "/" + prefix,
    readonly,
    softDelete,
    bulkOperations: bulk,
    fields,
    searchableFields,
  };
}

function parseFieldsFlag(raw: string): EntityField[] {
  return raw.split(",").map((f) => {
    const [nameType, ...rest] = f.trim().split(":");
    const required = nameType.endsWith("!");
    const name = toSnake(required ? nameType.slice(0, -1) : nameType);
    const type = (rest[0] || "string") as FieldType;
    return { name, type, required: required || true };
  });
}

// --- FastAPI generation ---

function sqlalchemyType(type: FieldType): string {
  switch (type) {
    case "string": return "String(255)";
    case "number": return "Integer";
    case "boolean": return "Boolean";
    case "date": return "Date";
    case "datetime": return "DateTime";
    case "text": return "Text";
    case "json": return "JSON";
  }
}

function generateFastAPIModel(config: EntityConfig): string {
  const className = toPascal(config.name);
  const imports = new Set(["Column"]);

  for (const f of config.fields) {
    switch (f.type) {
      case "string": imports.add("String"); break;
      case "number": imports.add("Integer"); break;
      case "boolean": imports.add("Boolean"); break;
      case "date": imports.add("Date"); break;
      case "datetime": imports.add("DateTime"); break;
      case "text": imports.add("Text"); break;
      case "json": imports.add("JSON"); break;
    }
  }

  if (config.softDelete) imports.add("DateTime");

  const importList = [...imports].sort().join(", ");
  const lines: string[] = [];

  lines.push(`from sqlalchemy import ${importList}`);

  if (config.softDelete) {
    lines.push(`from src.entities.base import BaseModel_, SoftDeleteMixin`);
    lines.push("");
    lines.push("");
    lines.push(`class ${className}(SoftDeleteMixin, BaseModel_):`);
  } else {
    lines.push(`from src.entities.base import BaseModel_`);
    lines.push("");
    lines.push("");
    lines.push(`class ${className}(BaseModel_):`);
  }

  lines.push(`    __tablename__ = "${config.tableName}"`);
  lines.push(`    __api_prefix__ = "${config.apiPrefix}"`);

  if (config.readonly) lines.push(`    __readonly__ = True`);
  if (config.softDelete) lines.push(`    __soft_delete__ = True`);
  if (!config.bulkOperations) lines.push(`    __bulk_operations__ = False`);

  if (config.searchableFields.length > 0) {
    const fields = config.searchableFields.map((f) => `"${f}"`).join(", ");
    lines.push(`    __searchable_fields__ = {${fields}}`);
  }

  lines.push("");

  for (const field of config.fields) {
    const nullable = field.required ? "nullable=False" : "nullable=True";
    lines.push(`    ${field.name} = Column(${sqlalchemyType(field.type)}, ${nullable})`);
  }

  lines.push("");
  return lines.join("\n");
}

// --- Fastify generation ---

function typeboxType(type: FieldType, required: boolean): string {
  const inner = (() => {
    switch (type) {
      case "string": return "Type.String()";
      case "number": return "Type.Number()";
      case "boolean": return "Type.Boolean()";
      case "date": return "Type.String({ format: 'date' })";
      case "datetime": return "Type.String({ format: 'date-time' })";
      case "text": return "Type.String()";
      case "json": return "Type.Any()";
    }
  })();

  if (!required) return `Type.Union([${inner}, Type.Null()])`;
  return inner;
}

function typeboxOptional(type: FieldType): string {
  switch (type) {
    case "string": return "Type.Optional(Type.String())";
    case "number": return "Type.Optional(Type.Number())";
    case "boolean": return "Type.Optional(Type.Boolean())";
    case "date": return "Type.Optional(Type.String({ format: 'date' }))";
    case "datetime": return "Type.Optional(Type.String({ format: 'date-time' }))";
    case "text": return "Type.Optional(Type.String())";
    case "json": return "Type.Optional(Type.Any())";
  }
}

function fieldMetaType(type: FieldType): { type: string; fieldType: string } {
  switch (type) {
    case "string": return { type: "str", fieldType: "text" };
    case "number": return { type: "int", fieldType: "number" };
    case "boolean": return { type: "bool", fieldType: "boolean" };
    case "date": return { type: "date", fieldType: "date" };
    case "datetime": return { type: "datetime", fieldType: "datetime" };
    case "text": return { type: "str", fieldType: "textarea" };
    case "json": return { type: "dict", fieldType: "textarea" };
  }
}

function prismaType(type: FieldType, required: boolean): string {
  const nullable = required ? "" : "?";
  switch (type) {
    case "string": return `String${nullable}   @db.VarChar(255)`;
    case "number": return `Int${nullable}`;
    case "boolean": return `Boolean${nullable}  @default(false)`;
    case "date": return `DateTime${nullable}`;
    case "datetime": return `DateTime${nullable}`;
    case "text": return `String${nullable}`;
    case "json": return `Json${nullable}`;
  }
}

function generateFastifySchemas(config: EntityConfig): string {
  const className = toPascal(config.name);
  const lines: string[] = [];

  lines.push(`import { Type, type Static } from '@sinclair/typebox';`);
  lines.push("");

  // Main schema
  lines.push(`export const ${className}Schema = Type.Object({`);
  lines.push(`  id: Type.String({ format: 'uuid' }),`);
  for (const f of config.fields) {
    lines.push(`  ${f.name}: ${typeboxType(f.type, f.required)},`);
  }
  lines.push(`  created_at: Type.String({ format: 'date-time' }),`);
  lines.push(`  updated_at: Type.String({ format: 'date-time' }),`);
  if (config.softDelete) lines.push(`  deleted_at: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),`);
  lines.push(`});`);
  lines.push("");
  lines.push(`export type ${className} = Static<typeof ${className}Schema>;`);
  lines.push("");

  // Create schema
  lines.push(`export const Create${className}Schema = Type.Object({`);
  for (const f of config.fields) {
    if (f.required) {
      lines.push(`  ${f.name}: ${typeboxType(f.type, true)},`);
    } else {
      lines.push(`  ${f.name}: ${typeboxOptional(f.type)},`);
    }
  }
  lines.push(`});`);
  lines.push("");
  lines.push(`export type Create${className} = Static<typeof Create${className}Schema>;`);
  lines.push("");

  // Update schema
  lines.push(`export const Update${className}Schema = Type.Object({`);
  for (const f of config.fields) {
    lines.push(`  ${f.name}: ${typeboxOptional(f.type)},`);
  }
  lines.push(`});`);
  lines.push("");
  lines.push(`export type Update${className} = Static<typeof Update${className}Schema>;`);
  lines.push("");

  return lines.join("\n");
}

function generateFastifyIndex(config: EntityConfig): string {
  const className = toPascal(config.name);
  const camelConfig = className.charAt(0).toLowerCase() + className.slice(1) + "Config";
  const allColumns = ["id", ...config.fields.map((f) => f.name), "created_at", "updated_at"];
  if (config.softDelete) allColumns.push("deleted_at");

  const lines: string[] = [];

  lines.push(`import { EntityRegistry, type EntityConfig, type FieldMeta } from '../_base/index.js';`);
  lines.push(`import { ${className}Schema, Create${className}Schema, Update${className}Schema } from './schemas.js';`);
  lines.push("");

  // FieldMeta array
  lines.push(`const fields: FieldMeta[] = [`);

  // id field
  lines.push(`  { key: 'id', label: 'Id', type: 'str', nullable: false, is_auto: true, is_primary_key: true, filterable: true, has_foreign_key: false, field_type: 'text' },`);

  for (const f of config.fields) {
    const meta = fieldMetaType(f.type);
    lines.push(`  { key: '${f.name}', label: '${toTitle(f.name)}', type: '${meta.type}', nullable: ${!f.required}, is_auto: false, is_primary_key: false, filterable: true, has_foreign_key: false, field_type: '${meta.fieldType}' },`);
  }

  // auto fields
  lines.push(`  { key: 'created_at', label: 'Created At', type: 'datetime', nullable: false, is_auto: true, is_primary_key: false, filterable: true, has_foreign_key: false, field_type: 'datetime' },`);
  lines.push(`  { key: 'updated_at', label: 'Updated At', type: 'datetime', nullable: false, is_auto: true, is_primary_key: false, filterable: true, has_foreign_key: false, field_type: 'datetime' },`);

  if (config.softDelete) {
    lines.push(`  { key: 'deleted_at', label: 'Deleted At', type: 'datetime', nullable: true, is_auto: true, is_primary_key: false, filterable: true, has_foreign_key: false, field_type: 'datetime' },`);
  }

  lines.push(`];`);
  lines.push("");

  // Entity config
  const tags = config.apiPrefix.replace(/^\//, "");
  lines.push(`export const ${camelConfig}: EntityConfig = {`);
  lines.push(`  name: '${className}',`);
  lines.push(`  tableName: '${config.tableName}',`);
  lines.push(`  prismaModel: '${className}',`);
  lines.push(`  apiPrefix: '${config.apiPrefix}',`);
  lines.push(`  tags: ['${tags}'],`);
  lines.push(`  readonly: ${config.readonly},`);
  lines.push(`  softDelete: ${config.softDelete},`);
  lines.push(`  bulkOperations: ${config.bulkOperations},`);
  lines.push(`  columnNames: [${allColumns.map((c) => `'${c}'`).join(", ")}],`);

  if (config.searchableFields.length > 0) {
    lines.push(`  searchableFields: [${config.searchableFields.map((f) => `'${f}'`).join(", ")}],`);
  } else {
    lines.push(`  searchableFields: [],`);
  }

  lines.push(`  fields,`);
  lines.push(`  schema: ${className}Schema,`);
  lines.push(`  createSchema: Create${className}Schema,`);
  lines.push(`  updateSchema: Update${className}Schema,`);
  lines.push(`};`);
  lines.push("");
  lines.push(`EntityRegistry.register(${camelConfig});`);
  lines.push("");

  return lines.join("\n");
}

function generatePrismaModel(config: EntityConfig): string {
  const className = toPascal(config.name);
  const lines: string[] = [];

  lines.push(`model ${className} {`);
  lines.push(`  id         String   @id @default(uuid())`);

  for (const f of config.fields) {
    const padded = f.name.padEnd(10);
    lines.push(`  ${padded} ${prismaType(f.type, f.required)}`);
  }

  if (config.softDelete) {
    lines.push(`  deleted_at DateTime?`);
  }

  lines.push(`  created_at DateTime @default(now())`);
  lines.push(`  updated_at DateTime @updatedAt`);
  lines.push("");

  // Add indexes for searchable fields
  for (const sf of config.searchableFields) {
    lines.push(`  @@index([${sf}])`);
  }

  lines.push(`  @@map("${config.tableName}")`);
  lines.push(`}`);

  return lines.join("\n");
}

// --- Frontend TypeScript interface generation ---

function tsType(type: FieldType, required: boolean): string {
  const base = (() => {
    switch (type) {
      case "string": case "text": case "date": case "datetime": return "string";
      case "number": return "number";
      case "boolean": return "boolean";
      case "json": return "Record<string, unknown>";
    }
  })();
  return required ? base : `${base} | null`;
}

function generateFrontendInterface(config: EntityConfig): string {
  const className = toPascal(config.name);
  const lines: string[] = [];

  lines.push(`export interface ${className} {`);
  lines.push(`  id: string;`);
  for (const f of config.fields) {
    lines.push(`  ${f.name}: ${tsType(f.type, f.required)};`);
  }
  if (config.softDelete) lines.push(`  deleted_at: string | null;`);
  lines.push(`  created_at: string;`);
  lines.push(`  updated_at: string;`);
  lines.push(`}`);
  lines.push("");

  lines.push(`export interface Create${className} {`);
  for (const f of config.fields) {
    if (f.required) {
      lines.push(`  ${f.name}: ${tsType(f.type, true)};`);
    } else {
      lines.push(`  ${f.name}?: ${tsType(f.type, false)};`);
    }
  }
  lines.push(`}`);
  lines.push("");

  lines.push(`export interface Update${className} {`);
  for (const f of config.fields) {
    lines.push(`  ${f.name}?: ${tsType(f.type, false)};`);
  }
  lines.push(`}`);
  lines.push("");

  return lines.join("\n");
}

// --- Mobile Dart model generation ---

function dartType(type: FieldType, required: boolean): string {
  const base = (() => {
    switch (type) {
      case "string": case "text": return "String";
      case "number": return "int";
      case "boolean": return "bool";
      case "date": case "datetime": return "DateTime";
      case "json": return "Map<String, dynamic>";
    }
  })();
  return required ? base : `${base}?`;
}

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function dartFromJson(fieldName: string, type: FieldType, required: boolean): string {
  const key = `json['${fieldName}']`;
  const isDate = type === "date" || type === "datetime";

  if (isDate && required) return `DateTime.parse(${key} as String)`;
  if (isDate && !required) return `${key} != null ? DateTime.parse(${key} as String) : null`;
  if (type === "json" && !required) return `${key} as Map<String, dynamic>?`;
  if (type === "json") return `${key} as Map<String, dynamic>`;

  const dartT = (() => {
    switch (type) {
      case "string": case "text": return "String";
      case "number": return "int";
      case "boolean": return "bool";
      default: return "String";
    }
  })();

  return required ? `${key} as ${dartT}` : `${key} as ${dartT}?`;
}

function dartToJson(fieldName: string, camelName: string, type: FieldType): string {
  const isDate = type === "date" || type === "datetime";
  if (isDate) return `'${fieldName}': ${camelName}?.toIso8601String()`;
  return `'${fieldName}': ${camelName}`;
}

function generateDartModel(config: EntityConfig): string {
  const className = toPascal(config.name);

  interface DartField {
    snake: string;
    camel: string;
    type: string;
    required: boolean;
    fieldType: FieldType;
  }

  const allFields: DartField[] = [
    { snake: "id", camel: "id", type: "String", required: true, fieldType: "string" },
    ...config.fields.map((f) => ({
      snake: f.name,
      camel: toCamel(f.name),
      type: dartType(f.type, f.required),
      required: f.required,
      fieldType: f.type,
    })),
  ];

  if (config.softDelete) {
    allFields.push({ snake: "deleted_at", camel: "deletedAt", type: "DateTime?", required: false, fieldType: "datetime" });
  }

  allFields.push(
    { snake: "created_at", camel: "createdAt", type: "DateTime", required: true, fieldType: "datetime" },
    { snake: "updated_at", camel: "updatedAt", type: "DateTime", required: true, fieldType: "datetime" },
  );

  const lines: string[] = [];

  lines.push(`class ${className} {`);

  // Fields
  for (const f of allFields) {
    lines.push(`  final ${f.type} ${f.camel};`);
  }
  lines.push("");

  // Constructor
  lines.push(`  const ${className}({`);
  for (const f of allFields) {
    if (f.required) {
      lines.push(`    required this.${f.camel},`);
    } else {
      lines.push(`    this.${f.camel},`);
    }
  }
  lines.push(`  });`);
  lines.push("");

  // fromJson
  lines.push(`  factory ${className}.fromJson(Map<String, dynamic> json) {`);
  lines.push(`    return ${className}(`);
  for (const f of allFields) {
    lines.push(`      ${f.camel}: ${dartFromJson(f.snake, f.fieldType, f.required)},`);
  }
  lines.push(`    );`);
  lines.push(`  }`);
  lines.push("");

  // toJson
  lines.push(`  Map<String, dynamic> toJson() {`);
  lines.push(`    return {`);
  for (const f of allFields) {
    lines.push(`      ${dartToJson(f.snake, f.camel, f.fieldType)},`);
  }
  lines.push(`    };`);
  lines.push(`  }`);
  lines.push("");

  // copyWith
  lines.push(`  ${className} copyWith({`);
  for (const f of allFields) {
    lines.push(`    ${f.type.replace("?", "")}? ${f.camel},`);
  }
  lines.push(`  }) {`);
  lines.push(`    return ${className}(`);
  for (const f of allFields) {
    lines.push(`      ${f.camel}: ${f.camel} ?? this.${f.camel},`);
  }
  lines.push(`    );`);
  lines.push(`  }`);

  lines.push(`}`);
  lines.push("");

  return lines.join("\n");
}

// --- Main ---

export async function gen(
  cwd: string,
  entityName: string,
  fieldsFlag?: string,
): Promise<void> {
  p.intro(`projx gen entity ${entityName}`);

  const configPath = join(cwd, ".projx");
  if (!existsSync(configPath)) {
    p.log.error("No .projx file found. Run 'npx create-projx init' first.");
    process.exit(1);
  }

  const projxConfig: ProjxConfig = JSON.parse(await readFile(configPath, "utf-8"));
  const componentPaths = await discoverComponentPaths(cwd, projxConfig.components);

  const hasFastapi = projxConfig.components.includes("fastapi");
  const hasFastify = projxConfig.components.includes("fastify");
  const hasFrontend = projxConfig.components.includes("frontend");
  const hasMobile = projxConfig.components.includes("mobile");

  if (!hasFastapi && !hasFastify) {
    p.log.error("No backend component found. Need fastapi or fastify.");
    process.exit(1);
  }

  let config: EntityConfig;

  if (fieldsFlag) {
    const fields = parseFieldsFlag(fieldsFlag);
    const snake = toSnake(entityName);
    const tableName = pluralize(snake);
    const kebab = toKebab(entityName);

    config = {
      name: entityName,
      tableName,
      apiPrefix: "/" + pluralize(kebab),
      readonly: false,
      softDelete: false,
      bulkOperations: true,
      fields,
      searchableFields: fields.filter((f) => f.type === "string" || f.type === "text").map((f) => f.name),
    };
  } else {
    config = await promptEntityConfig(entityName);
  }

  const generated: string[] = [];

  if (hasFastapi) {
    const dir = componentPaths.fastapi;
    const entityDir = join(cwd, dir, "src/entities", toSnake(config.name));

    if (existsSync(entityDir)) {
      p.log.warn(`${dir}/src/entities/${toSnake(config.name)}/ already exists. Skipping FastAPI.`);
    } else {
      await mkdir(entityDir, { recursive: true });
      await writeFile(join(entityDir, "_model.py"), generateFastAPIModel(config));
      generated.push(`${dir}/src/entities/${toSnake(config.name)}/_model.py`);
    }
  }

  if (hasFastify) {
    const dir = componentPaths.fastify;
    const moduleDir = join(cwd, dir, "src/modules", toKebab(config.name));

    if (existsSync(moduleDir)) {
      p.log.warn(`${dir}/src/modules/${toKebab(config.name)}/ already exists. Skipping Fastify.`);
    } else {
      await mkdir(moduleDir, { recursive: true });
      await writeFile(join(moduleDir, "schemas.ts"), generateFastifySchemas(config));
      await writeFile(join(moduleDir, "index.ts"), generateFastifyIndex(config));
      generated.push(`${dir}/src/modules/${toKebab(config.name)}/schemas.ts`);
      generated.push(`${dir}/src/modules/${toKebab(config.name)}/index.ts`);

      // Add import to app.ts
      const appPath = join(cwd, dir, "src/app.ts");
      if (existsSync(appPath)) {
        const appContent = await readFile(appPath, "utf-8");
        const importLine = `import './modules/${toKebab(config.name)}/index.js';`;
        if (!appContent.includes(importLine)) {
          const updated = appContent.replace(
            /^(import\s+'\.\/modules\/.*?';?\s*\n)/m,
            `$1${importLine}\n`,
          );
          if (updated !== appContent) {
            await writeFile(appPath, updated);
            generated.push(`${dir}/src/app.ts (import added)`);
          }
        }
      }

      // Add prisma model
      const prismaPath = join(cwd, dir, "prisma/schema.prisma");
      if (existsSync(prismaPath)) {
        const prismaContent = await readFile(prismaPath, "utf-8");
        const modelName = `model ${toPascal(config.name)}`;
        if (!prismaContent.includes(modelName)) {
          const prismaModel = generatePrismaModel(config);
          await writeFile(prismaPath, prismaContent.trimEnd() + "\n\n" + prismaModel + "\n");
          generated.push(`${dir}/prisma/schema.prisma (model added)`);
        }
      }
    }
  }

  if (hasFrontend) {
    const dir = componentPaths.frontend;
    const typesDir = join(cwd, dir, "src/types");
    const fileName = toKebab(config.name) + ".ts";
    const filePath = join(typesDir, fileName);

    if (existsSync(filePath)) {
      p.log.warn(`${dir}/src/types/${fileName} already exists. Skipping frontend types.`);
    } else {
      await mkdir(typesDir, { recursive: true });
      await writeFile(filePath, generateFrontendInterface(config));
      generated.push(`${dir}/src/types/${fileName}`);

      const barrelPath = join(typesDir, "index.ts");
      const exportLine = `export * from './${toKebab(config.name)}';`;
      if (existsSync(barrelPath)) {
        const content = await readFile(barrelPath, "utf-8");
        if (!content.includes(exportLine)) {
          await writeFile(barrelPath, content.trimEnd() + "\n" + exportLine + "\n");
        }
      } else {
        await writeFile(barrelPath, exportLine + "\n");
      }
      generated.push(`${dir}/src/types/index.ts`);
    }
  }

  if (hasMobile) {
    const dir = componentPaths.mobile;
    const entityDir = join(cwd, dir, "lib/entities", toSnake(config.name));
    const modelPath = join(entityDir, "model.dart");

    if (existsSync(modelPath)) {
      p.log.warn(`${dir}/lib/entities/${toSnake(config.name)}/model.dart already exists. Skipping mobile model.`);
    } else {
      await mkdir(entityDir, { recursive: true });
      await writeFile(modelPath, generateDartModel(config));
      generated.push(`${dir}/lib/entities/${toSnake(config.name)}/model.dart`);
    }
  }

  if (generated.length === 0) {
    p.log.warn("Nothing generated.");
    p.outro("");
    return;
  }

  p.log.success("Generated:");
  for (const f of generated) {
    p.log.info(`  ${f}`);
  }

  const className = toPascal(config.name);

  if (hasFastapi) {
    p.log.info("");
    p.log.info("FastAPI next steps:");
    p.log.info(`  alembic revision --autogenerate -m "add ${config.tableName}"`);
    p.log.info("  alembic upgrade head");
  }

  if (hasFastify) {
    p.log.info("");
    p.log.info("Fastify next steps:");
    p.log.info(`  npx prisma migrate dev --name add_${toSnake(config.name)}`);
  }

  if (hasFrontend) {
    p.log.info("");
    p.log.info("Frontend usage:");
    p.log.info(`  import type { ${className} } from '../types/${toKebab(config.name)}';`);
    p.log.info(`  const { data } = await api.list<${className}>('${config.apiPrefix}');`);
  }

  if (hasMobile) {
    p.log.info("");
    p.log.info("Mobile usage:");
    p.log.info(`  final item = ${className}.fromJson(json);`);
  }

  p.outro(`Entity ${className} created.`);
}
