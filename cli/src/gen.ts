import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import {
  type PackageManager,
  BACKEND_COMPONENTS,
  cleanupRepo,
  discoverComponentsFromMarkers,
  downloadRepo,
  pmCommands,
  readProjxConfig,
  toKebab,
  toSnake,
  writeProjxConfig,
} from './utils.js';

const FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'date',
  'datetime',
  'text',
  'json',
] as const;
type FieldType = (typeof FIELD_TYPES)[number];

const FIELD_TYPE_ALIASES: Record<string, FieldType> = {
  int: 'number',
  integer: 'number',
  bigint: 'number',
  number: 'number',
  float: 'number',
  double: 'number',
  decimal: 'number',
  real: 'number',
  bool: 'boolean',
  boolean: 'boolean',
  str: 'string',
  varchar: 'string',
  string: 'string',
  uuid: 'string',
  timestamp: 'datetime',
  datetime: 'datetime',
  date: 'date',
  text: 'text',
  json: 'json',
  jsonb: 'json',
};

function assertNeverFieldType(type: never): never {
  throw new Error(`unhandled field type: ${String(type)}`);
}

function normalizeFieldType(token: string, fieldName: string): FieldType {
  const normalized = FIELD_TYPE_ALIASES[token.toLowerCase()];
  if (normalized) return normalized;
  throw new Error(
    `unknown field type "${token}" for field "${fieldName}" — use one of: ${FIELD_TYPES.join(', ')}`,
  );
}

interface EntityField {
  name: string;
  type: FieldType;
  required: boolean;
  unique: boolean;
  generated: boolean;
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
    .join('');
}

function pluralize(s: string): string {
  if (
    s.endsWith('s') ||
    s.endsWith('x') ||
    s.endsWith('z') ||
    s.endsWith('sh') ||
    s.endsWith('ch')
  )
    return s + 'es';
  if (s.endsWith('y') && !/[aeiou]y$/i.test(s)) return s.slice(0, -1) + 'ies';
  return s + 's';
}

async function promptEntityConfig(name: string): Promise<EntityConfig> {
  const snake = toSnake(name);
  const tableName = pluralize(snake);
  const kebab = toKebab(name);
  const apiPrefix = '/' + pluralize(kebab);

  const tbl = (await p.text({
    message: 'Table name',
    placeholder: tableName,
    defaultValue: tableName,
  })) as string;
  if (p.isCancel(tbl)) process.exit(0);

  const prefix = (await p.text({
    message: 'API prefix',
    placeholder: apiPrefix,
    defaultValue: apiPrefix,
  })) as string;
  if (p.isCancel(prefix)) process.exit(0);

  const readonly = (await p.confirm({
    message: 'Readonly?',
    initialValue: false,
  })) as boolean;
  if (p.isCancel(readonly)) process.exit(0);

  const softDelete = (await p.confirm({
    message: 'Soft delete?',
    initialValue: false,
  })) as boolean;
  if (p.isCancel(softDelete)) process.exit(0);

  const bulk = (await p.confirm({
    message: 'Bulk operations?',
    initialValue: true,
  })) as boolean;
  if (p.isCancel(bulk)) process.exit(0);

  // Field prompts
  const fields: EntityField[] = [];
  p.log.info('Define fields (enter empty name to finish):');

  while (true) {
    const fieldName = (await p.text({
      message: `Field ${fields.length + 1} name`,
      placeholder: 'done',
      defaultValue: '',
    })) as string;
    if (p.isCancel(fieldName)) process.exit(0);
    if (!fieldName) break;

    const fieldType = (await p.select({
      message: `${fieldName} type`,
      options: FIELD_TYPES.map((t) => ({ value: t, label: t })),
      initialValue: 'string' as FieldType,
    })) as FieldType;
    if (p.isCancel(fieldType)) process.exit(0);

    const required = (await p.confirm({
      message: `${fieldName} required?`,
      initialValue: true,
    })) as boolean;
    if (p.isCancel(required)) process.exit(0);

    fields.push({
      name: toSnake(fieldName),
      type: fieldType,
      required,
      unique: false,
      generated: false,
    });
  }

  if (fields.length === 0) {
    p.log.warn("No fields defined. Adding a default 'name' field.");
    fields.push({
      name: 'name',
      type: 'string',
      required: true,
      unique: false,
      generated: false,
    });
  }

  // Searchable fields
  const stringFields = fields.filter(
    (f) => f.type === 'string' || f.type === 'text',
  );
  let searchableFields: string[] = [];

  if (stringFields.length > 0) {
    const selected = (await p.multiselect({
      message: 'Searchable fields',
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
    apiPrefix: prefix.startsWith('/') ? prefix : '/' + prefix,
    readonly,
    softDelete,
    bulkOperations: bulk,
    fields,
    searchableFields,
  };
}

function parseFieldsFlag(raw: string): EntityField[] {
  return raw.split(',').map((f) => {
    const [nameType, ...rest] = f.trim().split(':');
    const optional = nameType.endsWith('?');
    const marked = optional || nameType.endsWith('!');
    const name = toSnake(marked ? nameType.slice(0, -1) : nameType);
    const type = normalizeFieldType(rest[0] || 'string', name);
    const modifiers = new Set(rest.slice(1).map((item) => item.toLowerCase()));
    return {
      name,
      type,
      required: !optional,
      unique: modifiers.has('unique') || modifiers.has('@unique'),
      generated:
        modifiers.has('generated') ||
        modifiers.has('server') ||
        modifiers.has('server-generated'),
    };
  });
}

// --- FastAPI generation ---

function sqlalchemyType(type: FieldType): string {
  switch (type) {
    case 'string':
      return 'String(255)';
    case 'number':
      return 'Integer';
    case 'boolean':
      return 'Boolean';
    case 'date':
      return 'Date';
    case 'datetime':
      return 'DateTime';
    case 'text':
      return 'Text';
    case 'json':
      return 'JSON';
    default:
      return assertNeverFieldType(type);
  }
}

function generateFastAPIModel(config: EntityConfig): string {
  const className = toPascal(config.name);
  const imports = new Set(['Column']);

  for (const f of config.fields) {
    switch (f.type) {
      case 'string':
        imports.add('String');
        break;
      case 'number':
        imports.add('Integer');
        break;
      case 'boolean':
        imports.add('Boolean');
        break;
      case 'date':
        imports.add('Date');
        break;
      case 'datetime':
        imports.add('DateTime');
        break;
      case 'text':
        imports.add('Text');
        break;
      case 'json':
        imports.add('JSON');
        break;
    }
  }

  if (config.softDelete) imports.add('DateTime');

  const importList = [...imports].sort().join(', ');
  const lines: string[] = [];

  lines.push(`from sqlalchemy import ${importList}`);

  if (config.softDelete) {
    lines.push(`from src.entities.base import BaseModel_, SoftDeleteMixin`);
    lines.push('');
    lines.push('');
    lines.push(`class ${className}(SoftDeleteMixin, BaseModel_):`);
  } else {
    lines.push(`from src.entities.base import BaseModel_`);
    lines.push('');
    lines.push('');
    lines.push(`class ${className}(BaseModel_):`);
  }

  lines.push(`    __tablename__ = "${config.tableName}"`);
  lines.push(`    __api_prefix__ = "${config.apiPrefix}"`);

  if (config.readonly) lines.push(`    __readonly__ = True`);
  if (config.softDelete) lines.push(`    __soft_delete__ = True`);
  if (!config.bulkOperations) lines.push(`    __bulk_operations__ = False`);

  if (config.searchableFields.length > 0) {
    const fields = config.searchableFields.map((f) => `"${f}"`).join(', ');
    lines.push(`    __searchable_fields__ = {${fields}}`);
  }

  lines.push('');

  for (const field of config.fields) {
    const nullable = field.required ? 'nullable=False' : 'nullable=True';
    lines.push(
      `    ${field.name} = Column(${sqlalchemyType(field.type)}, ${nullable})`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

// --- Fastify generation ---

function typeboxType(type: FieldType, required: boolean): string {
  const inner = (() => {
    switch (type) {
      case 'string':
        return 'Type.String()';
      case 'number':
        return 'Type.Number()';
      case 'boolean':
        return 'Type.Boolean()';
      case 'date':
        return "Type.String({ format: 'date' })";
      case 'datetime':
        return "Type.String({ format: 'date-time' })";
      case 'text':
        return 'Type.String()';
      case 'json':
        return 'Type.Any()';
    }
  })();

  if (!required) return `Type.Union([${inner}, Type.Null()])`;
  return inner;
}

function typeboxOptional(type: FieldType): string {
  switch (type) {
    case 'string':
      return 'Type.Optional(Type.String())';
    case 'number':
      return 'Type.Optional(Type.Number())';
    case 'boolean':
      return 'Type.Optional(Type.Boolean())';
    case 'date':
      return "Type.Optional(Type.String({ format: 'date' }))";
    case 'datetime':
      return "Type.Optional(Type.String({ format: 'date-time' }))";
    case 'text':
      return 'Type.Optional(Type.String())';
    case 'json':
      return 'Type.Optional(Type.Any())';
  }
}

function prismaType(type: FieldType, required: boolean): string {
  const nullable = required ? '' : '?';
  switch (type) {
    case 'string':
      return `String${nullable}   @db.VarChar(255)`;
    case 'number':
      return `Int${nullable}`;
    case 'boolean':
      return `Boolean${nullable}  @default(false)`;
    case 'date':
      return `DateTime${nullable}`;
    case 'datetime':
      return `DateTime${nullable}`;
    case 'text':
      return `String${nullable}`;
    case 'json':
      return `Json${nullable}`;
  }
}

function prismaFieldType(field: EntityField): string {
  const base = prismaType(field.type, field.required);
  return field.unique ? `${base} @unique` : base;
}

function generateFastifySchemas(config: EntityConfig): string {
  const className = toPascal(config.name);
  const lines: string[] = [];

  lines.push(`import { Type, type Static } from '@sinclair/typebox';`);
  lines.push('');

  // Main schema
  lines.push(`export const ${className}Schema = Type.Object({`);
  lines.push(`  id: Type.String({ format: 'uuid' }),`);
  for (const f of config.fields) {
    lines.push(`  ${f.name}: ${typeboxType(f.type, f.required)},`);
  }
  lines.push(`  created_at: Type.String({ format: 'date-time' }),`);
  lines.push(`  updated_at: Type.String({ format: 'date-time' }),`);
  if (config.softDelete)
    lines.push(
      `  deleted_at: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),`,
    );
  lines.push(`});`);
  lines.push('');
  lines.push(`export type ${className} = Static<typeof ${className}Schema>;`);
  lines.push('');

  // Create schema
  lines.push(`export const Create${className}Schema = Type.Object({`);
  for (const f of config.fields.filter((field) => !field.generated)) {
    if (f.required) {
      lines.push(`  ${f.name}: ${typeboxType(f.type, true)},`);
    } else {
      lines.push(`  ${f.name}: ${typeboxOptional(f.type)},`);
    }
  }
  lines.push(`});`);
  lines.push('');
  lines.push(
    `export type Create${className} = Static<typeof Create${className}Schema>;`,
  );
  lines.push('');

  // Update schema
  lines.push(`export const Update${className}Schema = Type.Object({`);
  for (const f of config.fields.filter((field) => !field.generated)) {
    lines.push(`  ${f.name}: ${typeboxOptional(f.type)},`);
  }
  lines.push(`});`);
  lines.push('');
  lines.push(
    `export type Update${className} = Static<typeof Update${className}Schema>;`,
  );
  lines.push('');

  return lines.join('\n');
}

function generateFastifyIndex(config: EntityConfig): string {
  const className = toPascal(config.name);
  const camelConfig =
    className.charAt(0).toLowerCase() + className.slice(1) + 'Config';
  const generatedFields = config.fields.filter((field) => field.generated);

  const lines: string[] = [];

  lines.push(
    `import { EntityRegistry, type EntityConfig } from '../_base/index.js';`,
  );
  if (generatedFields.length > 0) {
    lines.push(`import { randomBytes } from 'node:crypto';`);
  }
  lines.push(
    `import { ${className}Schema, Create${className}Schema, Update${className}Schema } from './schemas.js';`,
  );
  lines.push('');

  for (const field of generatedFields) {
    lines.push(
      `function generate${className}${toPascal(field.name)}(): string {`,
    );
    lines.push(`  return randomBytes(8).toString('hex').toUpperCase();`);
    lines.push(`}`);
    lines.push('');
  }

  const tags = config.apiPrefix.replace(/^\//, '');
  lines.push(`export const ${camelConfig}: EntityConfig = {`);
  lines.push(`  name: '${className}',`);
  lines.push(`  tableName: '${config.tableName}',`);
  lines.push(`  prismaModel: '${className}',`);
  lines.push(`  apiPrefix: '${config.apiPrefix}',`);
  lines.push(`  tags: ['${tags}'],`);
  lines.push(`  readonly: ${config.readonly},`);
  lines.push(`  softDelete: ${config.softDelete},`);
  lines.push(`  bulkOperations: ${config.bulkOperations},`);

  if (config.searchableFields.length > 0) {
    lines.push(
      `  searchableFields: [${config.searchableFields.map((f) => `'${f}'`).join(', ')}],`,
    );
  } else {
    lines.push(`  searchableFields: [],`);
  }

  lines.push(`  schema: ${className}Schema,`);
  lines.push(`  createSchema: Create${className}Schema,`);
  lines.push(`  updateSchema: Update${className}Schema,`);
  if (generatedFields.length > 0) {
    lines.push(
      `  beforeCreateFields: [${generatedFields.map((field) => `'${field.name}'`).join(', ')}],`,
    );
    lines.push(`  beforeCreate: (_request, data) => {`);
    for (const field of generatedFields) {
      lines.push(
        `    if (!('${field.name}' in data) || data.${field.name} == null) {`,
      );
      lines.push(
        `      data.${field.name} = generate${className}${toPascal(field.name)}();`,
      );
      lines.push(`    }`);
    }
    lines.push(`  },`);
  }
  lines.push(`};`);
  lines.push('');
  lines.push(`EntityRegistry.register(${camelConfig});`);
  lines.push('');

  return lines.join('\n');
}

function generatePrismaModel(config: EntityConfig): string {
  const className = toPascal(config.name);
  const lines: string[] = [];

  lines.push(`model ${className} {`);
  lines.push(`  id         String   @id @default(uuid())`);

  for (const f of config.fields) {
    const padded = f.name.padEnd(10);
    lines.push(`  ${padded} ${prismaFieldType(f)}`);
  }

  if (config.softDelete) {
    lines.push(`  deleted_at DateTime?`);
  }

  lines.push(`  created_at DateTime @default(now())`);
  lines.push(`  updated_at DateTime @updatedAt`);
  lines.push('');

  // Add indexes for searchable fields
  for (const sf of config.searchableFields) {
    lines.push(`  @@index([${sf}])`);
  }

  lines.push(`  @@map("${config.tableName}")`);
  lines.push(`}`);

  return lines.join('\n');
}

function drizzleColumn(field: EntityField): string {
  let expr: string;
  switch (field.type) {
    case 'number':
      expr = `integer('${field.name}')`;
      break;
    case 'boolean':
      expr = `boolean('${field.name}')`;
      break;
    case 'date':
      expr = `date('${field.name}')`;
      break;
    case 'datetime':
      expr = `timestamp('${field.name}', { withTimezone: true })`;
      break;
    case 'json':
      expr = `jsonb('${field.name}')`;
      break;
    case 'text':
    case 'string':
      expr = `text('${field.name}')`;
      break;
  }
  if (field.required) expr += '.notNull()';
  if (field.unique) expr += '.unique()';
  return expr;
}

function generateDrizzleTable(config: EntityConfig): string {
  const lines: string[] = [];
  const tableConst = toCamel(pluralize(toPascal(config.name)));
  lines.push(`export const ${tableConst} = pgTable('${config.tableName}', {`);
  lines.push(`  id: uuid('id').primaryKey().defaultRandom(),`);
  lines.push(
    `  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),`,
  );
  lines.push(
    `  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),`,
  );
  if (config.softDelete) {
    lines.push(`  deletedAt: timestamp('deleted_at', { withTimezone: true }),`);
  }
  for (const field of config.fields) {
    lines.push(`  ${toCamel(field.name)}: ${drizzleColumn(field)},`);
  }
  lines.push(`});`);
  return lines.join('\n');
}

function drizzleImports(config: EntityConfig): string[] {
  const used = new Set<string>(['pgTable', 'uuid', 'timestamp']);
  for (const field of config.fields) {
    switch (field.type) {
      case 'number':
        used.add('integer');
        break;
      case 'boolean':
        used.add('boolean');
        break;
      case 'date':
        used.add('date');
        break;
      case 'datetime':
        used.add('timestamp');
        break;
      case 'json':
        used.add('jsonb');
        break;
      case 'text':
      case 'string':
        used.add('text');
        break;
    }
  }
  return [...used].sort();
}

// --- Express generation ---

function zodType(type: FieldType, required: boolean): string {
  const inner = (() => {
    switch (type) {
      case 'string':
      case 'text':
        return 'z.string()';
      case 'number':
        return 'z.number()';
      case 'boolean':
        return 'z.boolean()';
      case 'date':
        return 'z.string().date()';
      case 'datetime':
        return 'z.string().datetime()';
      case 'json':
        return 'z.unknown()';
    }
  })();

  return required ? inner : `${inner}.nullable()`;
}

function zodOptional(type: FieldType): string {
  switch (type) {
    case 'string':
    case 'text':
      return 'z.string().optional()';
    case 'number':
      return 'z.number().optional()';
    case 'boolean':
      return 'z.boolean().optional()';
    case 'date':
      return 'z.string().date().optional()';
    case 'datetime':
      return 'z.string().datetime().optional()';
    case 'json':
      return 'z.unknown().optional()';
  }
}

function generateExpressSchemas(config: EntityConfig): string {
  const className = toPascal(config.name);
  const lines: string[] = [];

  lines.push(`import { z } from 'zod';`);
  lines.push('');

  lines.push(`export const ${className}Schema = z.object({`);
  lines.push(`  id: z.string().uuid(),`);
  for (const f of config.fields) {
    lines.push(`  ${f.name}: ${zodType(f.type, f.required)},`);
  }
  lines.push(`  created_at: z.string().datetime(),`);
  lines.push(`  updated_at: z.string().datetime(),`);
  if (config.softDelete)
    lines.push(`  deleted_at: z.string().datetime().nullable(),`);
  lines.push(`});`);
  lines.push('');
  lines.push(`export type ${className} = z.infer<typeof ${className}Schema>;`);
  lines.push('');

  lines.push(`export const Create${className}Schema = z.object({`);
  for (const f of config.fields.filter((field) => !field.generated)) {
    if (f.required) {
      lines.push(`  ${f.name}: ${zodType(f.type, true)},`);
    } else {
      lines.push(`  ${f.name}: ${zodOptional(f.type)},`);
    }
  }
  lines.push(`});`);
  lines.push('');
  lines.push(
    `export type Create${className} = z.infer<typeof Create${className}Schema>;`,
  );
  lines.push('');

  lines.push(`export const Update${className}Schema = z.object({`);
  for (const f of config.fields.filter((field) => !field.generated)) {
    lines.push(`  ${f.name}: ${zodOptional(f.type)},`);
  }
  lines.push(`});`);
  lines.push('');
  lines.push(
    `export type Update${className} = z.infer<typeof Update${className}Schema>;`,
  );
  lines.push('');

  return lines.join('\n');
}

function generateExpressIndex(config: EntityConfig): string {
  const className = toPascal(config.name);
  const camelConfig =
    className.charAt(0).toLowerCase() + className.slice(1) + 'Config';
  const generatedFields = config.fields.filter((field) => field.generated);
  const tags = config.apiPrefix.replace(/^\//, '');

  const lines: string[] = [];

  lines.push(
    `import { EntityRegistry, type EntityConfig } from '../_base/index.js';`,
  );
  if (generatedFields.length > 0) {
    lines.push(`import { randomBytes } from 'node:crypto';`);
  }
  lines.push(
    `import { ${className}Schema, Create${className}Schema, Update${className}Schema } from './schemas.js';`,
  );
  lines.push('');

  for (const field of generatedFields) {
    lines.push(
      `function generate${className}${toPascal(field.name)}(): string {`,
    );
    lines.push(`  return randomBytes(8).toString('hex').toUpperCase();`);
    lines.push(`}`);
    lines.push('');
  }

  lines.push(`export const ${camelConfig}: EntityConfig = {`);
  lines.push(`  name: '${className}',`);
  lines.push(`  tableName: '${config.tableName}',`);
  lines.push(`  prismaModel: '${className}',`);
  lines.push(`  apiPrefix: '${config.apiPrefix}',`);
  lines.push(`  tags: ['${tags}'],`);
  lines.push(`  readonly: ${config.readonly},`);
  lines.push(`  softDelete: ${config.softDelete},`);
  lines.push(`  bulkOperations: ${config.bulkOperations},`);
  if (config.searchableFields.length > 0) {
    lines.push(
      `  searchableFields: [${config.searchableFields.map((f) => `'${f}'`).join(', ')}],`,
    );
  } else {
    lines.push(`  searchableFields: [],`);
  }
  lines.push(`  schema: ${className}Schema,`);
  lines.push(`  createSchema: Create${className}Schema,`);
  lines.push(`  updateSchema: Update${className}Schema,`);
  if (generatedFields.length > 0) {
    lines.push(
      `  beforeCreateFields: [${generatedFields.map((field) => `'${field.name}'`).join(', ')}],`,
    );
    lines.push(`  beforeCreate: (_request, data) => {`);
    for (const field of generatedFields) {
      lines.push(
        `    if (!('${field.name}' in data) || data.${field.name} == null) {`,
      );
      lines.push(
        `      data.${field.name} = generate${className}${toPascal(field.name)}();`,
      );
      lines.push(`    }`);
    }
    lines.push(`  },`);
  }
  lines.push(`};`);
  lines.push('');
  lines.push(`EntityRegistry.register(${camelConfig});`);
  lines.push('');

  return lines.join('\n');
}

// --- Frontend TypeScript interface generation ---

function tsType(type: FieldType, required: boolean): string {
  const base = (() => {
    switch (type) {
      case 'string':
      case 'text':
      case 'date':
      case 'datetime':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'json':
        return 'Record<string, unknown>';
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
  lines.push('');

  lines.push(`export interface Create${className} {`);
  for (const f of config.fields) {
    if (f.required) {
      lines.push(`  ${f.name}: ${tsType(f.type, true)};`);
    } else {
      lines.push(`  ${f.name}?: ${tsType(f.type, false)};`);
    }
  }
  lines.push(`}`);
  lines.push('');

  lines.push(`export interface Update${className} {`);
  for (const f of config.fields) {
    lines.push(`  ${f.name}?: ${tsType(f.type, false)};`);
  }
  lines.push(`}`);
  lines.push('');

  return lines.join('\n');
}

// --- Mobile Dart model generation ---

function dartType(type: FieldType, required: boolean): string {
  const base = (() => {
    switch (type) {
      case 'string':
      case 'text':
        return 'String';
      case 'number':
        return 'int';
      case 'boolean':
        return 'bool';
      case 'date':
      case 'datetime':
        return 'DateTime';
      case 'json':
        return 'Map<String, dynamic>';
    }
  })();
  return required ? base : `${base}?`;
}

function toCamel(s: string): string {
  const pascal = toPascal(s);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function dartFromJson(
  fieldName: string,
  type: FieldType,
  required: boolean,
): string {
  const key = `json['${fieldName}']`;
  const isDate = type === 'date' || type === 'datetime';

  if (isDate && required) return `DateTime.parse(${key} as String)`;
  if (isDate && !required)
    return `${key} != null ? DateTime.parse(${key} as String) : null`;
  if (type === 'json' && !required) return `${key} as Map<String, dynamic>?`;
  if (type === 'json') return `${key} as Map<String, dynamic>`;

  const dartT = (() => {
    switch (type) {
      case 'string':
      case 'text':
        return 'String';
      case 'number':
        return 'int';
      case 'boolean':
        return 'bool';
      default:
        return 'String';
    }
  })();

  return required ? `${key} as ${dartT}` : `${key} as ${dartT}?`;
}

function dartToJson(
  fieldName: string,
  camelName: string,
  type: FieldType,
  required: boolean,
): string {
  const isDate = type === 'date' || type === 'datetime';
  if (isDate && required)
    return `'${fieldName}': ${camelName}.toIso8601String()`;
  if (isDate && !required)
    return `'${fieldName}': ${camelName}?.toIso8601String()`;
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
    {
      snake: 'id',
      camel: 'id',
      type: 'String',
      required: true,
      fieldType: 'string',
    },
    ...config.fields.map((f) => ({
      snake: f.name,
      camel: toCamel(f.name),
      type: dartType(f.type, f.required),
      required: f.required,
      fieldType: f.type,
    })),
  ];

  if (config.softDelete) {
    allFields.push({
      snake: 'deleted_at',
      camel: 'deletedAt',
      type: 'DateTime?',
      required: false,
      fieldType: 'datetime',
    });
  }

  allFields.push(
    {
      snake: 'created_at',
      camel: 'createdAt',
      type: 'DateTime',
      required: true,
      fieldType: 'datetime',
    },
    {
      snake: 'updated_at',
      camel: 'updatedAt',
      type: 'DateTime',
      required: true,
      fieldType: 'datetime',
    },
  );

  const lines: string[] = [];

  lines.push(`class ${className} {`);

  // Fields
  for (const f of allFields) {
    lines.push(`  final ${f.type} ${f.camel};`);
  }
  lines.push('');

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
  lines.push('');

  // fromJson
  lines.push(`  factory ${className}.fromJson(Map<String, dynamic> json) {`);
  lines.push(`    return ${className}(`);
  for (const f of allFields) {
    lines.push(
      `      ${f.camel}: ${dartFromJson(f.snake, f.fieldType, f.required)},`,
    );
  }
  lines.push(`    );`);
  lines.push(`  }`);
  lines.push('');

  // toJson
  lines.push(`  Map<String, dynamic> toJson() {`);
  lines.push(`    return {`);
  for (const f of allFields) {
    lines.push(
      `      ${dartToJson(f.snake, f.camel, f.fieldType, f.required)},`,
    );
  }
  lines.push(`    };`);
  lines.push(`  }`);
  lines.push('');

  // copyWith
  lines.push(`  ${className} copyWith({`);
  for (const f of allFields) {
    lines.push(`    ${f.type.replace('?', '')}? ${f.camel},`);
  }
  lines.push(`  }) {`);
  lines.push(`    return ${className}(`);
  for (const f of allFields) {
    lines.push(`      ${f.camel}: ${f.camel} ?? this.${f.camel},`);
  }
  lines.push(`    );`);
  lines.push(`  }`);

  lines.push(`}`);
  lines.push('');

  return lines.join('\n');
}

// --- Test generation ---

type SampleVariant = 'create' | 'update' | 'alt';

function pyHttpLiteral(
  type: FieldType,
  variant: SampleVariant = 'create',
): string {
  switch (type) {
    case 'string':
    case 'text':
      return variant === 'create'
        ? '"sample text"'
        : variant === 'update'
          ? '"updated text"'
          : '"alt text"';
    case 'number':
      return variant === 'create' ? '42' : variant === 'update' ? '100' : '7';
    case 'boolean':
      return variant === 'create' ? 'True' : 'False';
    case 'date':
      return variant === 'alt' ? '"2026-02-01"' : '"2026-01-01"';
    case 'datetime':
      return variant === 'alt'
        ? '"2026-02-01T00:00:00"'
        : '"2026-01-01T00:00:00"';
    case 'json':
      return '{}';
  }
}

function pyOrmLiteral(
  type: FieldType,
  variant: SampleVariant = 'create',
): string {
  switch (type) {
    case 'string':
    case 'text':
      return variant === 'create'
        ? '"sample text"'
        : variant === 'update'
          ? '"updated text"'
          : '"alt text"';
    case 'number':
      return variant === 'create' ? '42' : variant === 'update' ? '100' : '7';
    case 'boolean':
      return variant === 'create' ? 'True' : 'False';
    case 'date':
      return variant === 'alt' ? 'date(2026, 2, 1)' : 'date(2026, 1, 1)';
    case 'datetime':
      return variant === 'alt'
        ? 'datetime(2026, 2, 1, 0, 0, 0)'
        : 'datetime(2026, 1, 1, 0, 0, 0)';
    case 'json':
      return '{}';
  }
}

function tsLiteral(type: FieldType, variant: SampleVariant = 'create'): string {
  switch (type) {
    case 'string':
    case 'text':
      return variant === 'create'
        ? "'sample text'"
        : variant === 'update'
          ? "'updated text'"
          : "'alt text'";
    case 'number':
      return variant === 'create' ? '42' : variant === 'update' ? '100' : '7';
    case 'boolean':
      return variant === 'create' ? 'true' : 'false';
    case 'date':
      return variant === 'alt' ? "'2026-02-01'" : "'2026-01-01'";
    case 'datetime':
      return variant === 'alt'
        ? "'2026-02-01T00:00:00.000Z'"
        : "'2026-01-01T00:00:00.000Z'";
    case 'json':
      return '{}';
  }
}

function pickFilterField(fields: EntityField[]): EntityField {
  return (
    fields.find((f) => f.type === 'string' || f.type === 'text') ??
    fields.find((f) => f.type === 'number') ??
    fields.find((f) => f.type === 'boolean') ??
    fields[0]
  );
}

function generateFastapiTest(config: EntityConfig): string {
  const className = toPascal(config.name);
  const snake = toSnake(config.name);
  const apiUrl = `/api/v1${config.apiPrefix}/`;
  const filterField = pickFilterField(config.fields);

  const needsDate = config.fields.some((f) => f.type === 'date');
  const needsDatetime = config.fields.some((f) => f.type === 'datetime');

  const dateImports: string[] = [];
  if (needsDate) dateImports.push('date');
  if (needsDatetime) dateImports.push('datetime');

  const lines: string[] = [];

  if (dateImports.length > 0) {
    lines.push(`from datetime import ${dateImports.join(', ')}`);
    lines.push('');
  }

  lines.push(`from src.entities.${snake} import ${className}`);
  lines.push(`from tests.base_entity_api_test import BaseEntityApiTest`);
  lines.push('');
  lines.push('');
  lines.push(`class Test${className}Entity(BaseEntityApiTest):`);
  lines.push(`    __test__ = True`);
  lines.push(`    endpoint = "${apiUrl}"`);

  // create_payload
  lines.push(`    create_payload = {`);
  for (const f of config.fields) {
    lines.push(`        "${f.name}": ${pyHttpLiteral(f.type, 'create')},`);
  }
  lines.push(`    }`);

  // update_payload — pick first field
  const updateField = config.fields[0];
  lines.push(
    `    update_payload = {"${updateField.name}": ${pyHttpLiteral(updateField.type, 'update')}}`,
  );
  lines.push(`    invalid_payload: dict = {}`);

  // filter_field/values
  lines.push(`    filter_field = "${filterField.name}"`);
  lines.push(`    filter_value = ${pyHttpLiteral(filterField.type, 'create')}`);
  lines.push(
    `    other_filter_value = ${pyHttpLiteral(filterField.type, 'alt')}`,
  );
  lines.push('');

  // make_model
  lines.push(`    def make_model(self, index: int, **overrides):`);
  lines.push(`        data = {`);
  for (const f of config.fields) {
    lines.push(`            "${f.name}": ${pyOrmLiteral(f.type, 'create')},`);
  }
  lines.push(`        }`);
  lines.push(`        data.update(overrides)`);
  lines.push(`        return ${className}(**data)`);
  lines.push('');

  return lines.join('\n');
}

function generateFastifyTest(config: EntityConfig): string {
  const className = toPascal(config.name);
  const basePath = `/api/v1${config.apiPrefix}`;
  const updateField = config.fields[0];
  const uniqueFields = config.fields.filter((field) => field.unique);

  const lines: string[] = [];

  lines.push(
    `import { describeCrudEntity } from '../helpers/crud-test-base.js';`,
  );
  lines.push(
    `import { Create${className}Schema } from '../../src/modules/${toKebab(config.name)}/schemas.js';`,
  );
  lines.push('');
  lines.push(`describeCrudEntity({`);
  lines.push(`  entityName: '${className}',`);
  lines.push(`  basePath: '${basePath}',`);
  lines.push(`  prismaModel: '${className}',`);
  lines.push(`  createSchema: Create${className}Schema,`);
  lines.push(`  updatePayload: {`);
  lines.push(
    `    ${updateField.name}: ${tsLiteral(updateField.type, 'update')},`,
  );
  lines.push(`  },`);
  if (uniqueFields.length > 0) {
    lines.push(
      `  uniqueFields: [${uniqueFields.map((field) => `'${field.name}'`).join(', ')}],`,
    );
  }
  lines.push(`});`);
  lines.push('');

  return lines.join('\n');
}

function generateExpressTest(config: EntityConfig): string {
  const className = toPascal(config.name);
  const basePath = `/api/v1${config.apiPrefix}`;
  const updateField = config.fields[0];
  const uniqueFields = config.fields.filter((field) => field.unique);

  const lines: string[] = [];

  lines.push(
    `import { describeCrudEntity } from '../helpers/crud-test-base.js';`,
  );
  lines.push(
    `import { Create${className}Schema } from '../../src/modules/${toKebab(config.name)}/schemas.js';`,
  );
  lines.push('');
  lines.push(`describeCrudEntity({`);
  lines.push(`  entityName: '${className}',`);
  lines.push(`  basePath: '${basePath}',`);
  lines.push(`  prismaModel: '${className}',`);
  lines.push(`  createSchema: Create${className}Schema,`);
  lines.push(`  updatePayload: {`);
  lines.push(
    `    ${updateField.name}: ${tsLiteral(updateField.type, 'update')},`,
  );
  lines.push(`  },`);
  if (uniqueFields.length > 0) {
    lines.push(
      `  uniqueFields: [${uniqueFields.map((field) => `'${field.name}'`).join(', ')}],`,
    );
  }
  lines.push(`});`);
  lines.push('');

  return lines.join('\n');
}

function addonGenEntityPath(
  repoDir: string,
  orm: string,
  fileName: string,
): string {
  return join(repoDir, 'addons', 'orms', orm, 'gen-entity', fileName);
}

function sampleValue(field: EntityField): string {
  switch (field.type) {
    case 'string':
    case 'text':
      return `'sample-${field.name}'`;
    case 'number':
      return '1';
    case 'boolean':
      return 'true';
    case 'date':
      return "'2025-01-01'";
    case 'datetime':
      return "'2025-01-01T00:00:00Z'";
    case 'json':
      return '{}';
  }
}

function sampleJsonPayload(fields: EntityField[]): string {
  const props = fields
    .filter((f) => !f.generated)
    .map((f) => `${f.name}: ${sampleValue(f)}`);
  return `{ ${props.join(', ')} }`;
}

function updateJsonPayload(fields: EntityField[]): string {
  const editable = fields.find(
    (f) => !f.generated && (f.type === 'string' || f.type === 'text'),
  );
  if (editable) return `{ ${editable.name}: 'updated-${editable.name}' }`;
  const numeric = fields.find((f) => !f.generated && f.type === 'number');
  if (numeric) return `{ ${numeric.name}: 2 }`;
  return sampleJsonPayload(fields);
}

function insertAtAnchor(
  content: string,
  anchor: string,
  insertion: string,
): string {
  if (content.includes(insertion)) return content;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(anchor)) {
      lines.splice(i + 1, 0, insertion);
      return lines.join('\n');
    }
  }
  return content;
}

async function fillTemplate(
  repoDir: string,
  orm: string,
  fileName: string,
  vars: Record<string, string>,
): Promise<string> {
  const path = addonGenEntityPath(repoDir, orm, fileName);
  if (!existsSync(path)) {
    throw new Error(`Addon template not found: ${path}`);
  }
  let content = await readFile(path, 'utf-8');
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`__${key}__`, value);
  }
  return content;
}

interface DrizzleEntityVars extends Record<string, string> {
  ENTITY_PASCAL: string;
  TABLE_CAMEL: string;
  API_PREFIX: string;
  TAG: string;
  SEARCHABLE_FIELDS_ARRAY: string;
  BULK_OPERATIONS: string;
  SAMPLE_PAYLOAD: string;
  UPDATE_PAYLOAD: string;
}

function buildDrizzleEntityVars(config: EntityConfig): DrizzleEntityVars {
  const pascal = toPascal(config.name);
  return {
    ENTITY_PASCAL: pascal,
    TABLE_CAMEL: toCamel(pluralize(pascal)),
    API_PREFIX: config.apiPrefix,
    TAG: config.apiPrefix.replace(/^\//, ''),
    SEARCHABLE_FIELDS_ARRAY: config.searchableFields
      .map((f) => `'${f}'`)
      .join(', '),
    BULK_OPERATIONS: String(config.bulkOperations),
    SAMPLE_PAYLOAD: sampleJsonPayload(config.fields),
    UPDATE_PAYLOAD: updateJsonPayload(config.fields),
  };
}

function sequelizeFieldType(field: EntityField): {
  dataType: string;
  tsType: string;
} {
  switch (field.type) {
    case 'string':
      return { dataType: 'STRING', tsType: 'string' };
    case 'text':
      return { dataType: 'TEXT', tsType: 'string' };
    case 'number':
      return { dataType: 'INTEGER', tsType: 'number' };
    case 'boolean':
      return { dataType: 'BOOLEAN', tsType: 'boolean' };
    case 'date':
      return { dataType: 'DATEONLY', tsType: 'Date' };
    case 'datetime':
      return { dataType: 'DATE', tsType: 'Date' };
    case 'json':
      return { dataType: 'JSONB', tsType: 'unknown' };
  }
}

function sequelizeFieldDeclarations(fields: EntityField[]): string {
  return fields
    .map((f) => {
      const { tsType } = sequelizeFieldType(f);
      const nullable = f.required ? '' : ' | null';
      return `  declare ${toCamel(f.name)}: ${tsType}${nullable};`;
    })
    .join('\n');
}

function sequelizeFieldDefinitions(fields: EntityField[]): string {
  return fields
    .map((f) => {
      const { dataType } = sequelizeFieldType(f);
      const parts: string[] = [`type: DataTypes.${dataType}`];
      if (f.required) parts.push('allowNull: false');
      else parts.push('allowNull: true');
      if (f.unique) parts.push('unique: true');
      return `    ${toCamel(f.name)}: { ${parts.join(', ')} },`;
    })
    .join('\n');
}

interface SequelizeEntityVars extends Record<string, string> {
  ENTITY_PASCAL: string;
  ENTITY_KEBAB: string;
  TABLE_NAME: string;
  API_PREFIX: string;
  TAG: string;
  SEARCHABLE_FIELDS_ARRAY: string;
  BULK_OPERATIONS: string;
  SAMPLE_PAYLOAD: string;
  UPDATE_PAYLOAD: string;
  FIELD_DECLARATIONS: string;
  FIELD_DEFINITIONS: string;
}

function buildSequelizeEntityVars(config: EntityConfig): SequelizeEntityVars {
  const pascal = toPascal(config.name);
  const kebab = toKebab(config.name);
  return {
    ENTITY_PASCAL: pascal,
    ENTITY_KEBAB: kebab,
    TABLE_NAME: config.tableName,
    API_PREFIX: config.apiPrefix,
    TAG: config.apiPrefix.replace(/^\//, ''),
    SEARCHABLE_FIELDS_ARRAY: config.searchableFields
      .map((f) => `'${f}'`)
      .join(', '),
    BULK_OPERATIONS: String(config.bulkOperations),
    SAMPLE_PAYLOAD: sampleJsonPayload(config.fields),
    UPDATE_PAYLOAD: updateJsonPayload(config.fields),
    FIELD_DECLARATIONS: sequelizeFieldDeclarations(config.fields),
    FIELD_DEFINITIONS: sequelizeFieldDefinitions(config.fields),
  };
}

function typeormColumnType(field: EntityField): string {
  switch (field.type) {
    case 'string':
      return 'varchar';
    case 'text':
      return 'text';
    case 'number':
      return 'integer';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'datetime':
      return 'timestamptz';
    case 'json':
      return 'jsonb';
  }
}

function typeormColumnTsType(field: EntityField): string {
  switch (field.type) {
    case 'string':
    case 'text':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
    case 'datetime':
      return 'Date';
    case 'json':
      return 'unknown';
  }
}

function typeormColumnDecorators(fields: EntityField[]): string {
  return fields
    .map((f) => {
      const dbName = f.name;
      const propName = toCamel(f.name);
      const opts: string[] = [
        `type: '${typeormColumnType(f)}'`,
        `name: '${dbName}'`,
      ];
      if (!f.required) opts.push('nullable: true');
      if (f.unique) opts.push('unique: true');
      const tsType = typeormColumnTsType(f);
      const nullable = f.required ? '!' : '?';
      return `  @Column({ ${opts.join(', ')} })\n  ${propName}${nullable}: ${tsType}${f.required ? '' : ' | null'};`;
    })
    .join('\n\n');
}

interface TypeormEntityVars extends Record<string, string> {
  ENTITY_PASCAL: string;
  ENTITY_KEBAB: string;
  TABLE_NAME: string;
  API_PREFIX: string;
  TAG: string;
  SEARCHABLE_FIELDS_ARRAY: string;
  BULK_OPERATIONS: string;
  SAMPLE_PAYLOAD: string;
  UPDATE_PAYLOAD: string;
  COLUMN_DECORATORS: string;
}

function buildTypeormEntityVars(config: EntityConfig): TypeormEntityVars {
  const pascal = toPascal(config.name);
  const kebab = toKebab(config.name);
  return {
    ENTITY_PASCAL: pascal,
    ENTITY_KEBAB: kebab,
    TABLE_NAME: config.tableName,
    API_PREFIX: config.apiPrefix,
    TAG: config.apiPrefix.replace(/^\//, ''),
    SEARCHABLE_FIELDS_ARRAY: config.searchableFields
      .map((f) => `'${f}'`)
      .join(', '),
    BULK_OPERATIONS: String(config.bulkOperations),
    SAMPLE_PAYLOAD: sampleJsonPayload(config.fields),
    UPDATE_PAYLOAD: updateJsonPayload(config.fields),
    COLUMN_DECORATORS: typeormColumnDecorators(config.fields),
  };
}

async function appendTypeormEntity(
  repoDir: string,
  cwd: string,
  dir: string,
  framework: 'fastify' | 'express',
  config: EntityConfig,
  generated: string[],
): Promise<void> {
  const vars = buildTypeormEntityVars(config);
  const kebab = vars.ENTITY_KEBAB;

  const entitiesDir = join(cwd, dir, 'src/entities');
  await mkdir(entitiesDir, { recursive: true });
  const entityPath = join(entitiesDir, `${kebab}.ts`);
  if (!existsSync(entityPath)) {
    const entitySource = await fillTemplate(
      repoDir,
      'typeorm',
      'entity.ts',
      vars,
    );
    await writeFile(entityPath, entitySource);
    generated.push(`${dir}/src/entities/${kebab}.ts`);
  }

  const entitiesIndexPath = join(entitiesDir, 'index.ts');
  if (existsSync(entitiesIndexPath)) {
    let content = await readFile(entitiesIndexPath, 'utf-8');
    const importLine = `import { ${vars.ENTITY_PASCAL} } from './${kebab}.js';`;
    const exportLine = `  ${vars.ENTITY_PASCAL},`;
    const updated = insertAtAnchor(
      insertAtAnchor(content, 'projx-anchor: model-imports', importLine),
      'projx-anchor: model-exports',
      exportLine,
    );
    if (updated !== content) {
      content = updated;
      await writeFile(entitiesIndexPath, content);
      generated.push(`${dir}/src/entities/index.ts (entity wired)`);
    }
  }

  const moduleDir = join(cwd, dir, 'src/modules', kebab);
  if (!existsSync(moduleDir)) {
    await mkdir(moduleDir, { recursive: true });
    const routerSource = await fillTemplate(
      repoDir,
      'typeorm',
      framework === 'fastify' ? 'fastify-router.ts' : 'express-router.ts',
      vars,
    );
    await writeFile(join(moduleDir, 'index.ts'), routerSource);
    generated.push(`${dir}/src/modules/${kebab}/index.ts`);
  }

  const appPath = join(cwd, dir, 'src/app.ts');
  if (existsSync(appPath)) {
    let appContent = await readFile(appPath, 'utf-8');
    const importLine = `import { register${vars.ENTITY_PASCAL}Entity } from './modules/${kebab}/index.js';`;
    const registrationLine =
      framework === 'fastify'
        ? `  await register${vars.ENTITY_PASCAL}Entity(app);`
        : `  register${vars.ENTITY_PASCAL}Entity(app);`;
    const updated = insertAtAnchor(
      insertAtAnchor(appContent, 'projx-anchor: entity-imports', importLine),
      'projx-anchor: entity-registrations',
      registrationLine,
    );
    if (updated !== appContent) {
      appContent = updated;
      await writeFile(appPath, appContent);
      generated.push(`${dir}/src/app.ts (entity wired)`);
    }
  }

  const testsDir =
    framework === 'fastify'
      ? join(cwd, dir, 'tests/modules')
      : join(cwd, dir, 'tests');
  await mkdir(testsDir, { recursive: true });
  const testFile = join(testsDir, `${kebab}.test.ts`);
  if (!existsSync(testFile)) {
    const testSource = await fillTemplate(
      repoDir,
      'typeorm',
      framework === 'fastify' ? 'fastify-test.ts' : 'express-test.ts',
      vars,
    );
    await writeFile(testFile, testSource);
    const testRel =
      framework === 'fastify'
        ? `tests/modules/${kebab}.test.ts`
        : `tests/${kebab}.test.ts`;
    generated.push(`${dir}/${testRel}`);
  }
}

async function appendSequelizeEntity(
  repoDir: string,
  cwd: string,
  dir: string,
  framework: 'fastify' | 'express',
  config: EntityConfig,
  generated: string[],
): Promise<void> {
  const vars = buildSequelizeEntityVars(config);
  const kebab = vars.ENTITY_KEBAB;

  const modelsDir = join(cwd, dir, 'src/models');
  await mkdir(modelsDir, { recursive: true });
  const modelPath = join(modelsDir, `${kebab}.ts`);
  if (!existsSync(modelPath)) {
    const modelSource = await fillTemplate(
      repoDir,
      'sequelize',
      'model.ts',
      vars,
    );
    await writeFile(modelPath, modelSource);
    generated.push(`${dir}/src/models/${kebab}.ts`);
  }

  const modelsIndexPath = join(modelsDir, 'index.ts');
  if (existsSync(modelsIndexPath)) {
    let content = await readFile(modelsIndexPath, 'utf-8');
    const importLine = `import { ${vars.ENTITY_PASCAL} } from './${kebab}.js';`;
    const exportLine = `  ${vars.ENTITY_PASCAL},`;
    const updated = insertAtAnchor(
      insertAtAnchor(content, 'projx-anchor: model-imports', importLine),
      'projx-anchor: model-exports',
      exportLine,
    );
    if (updated !== content) {
      content = updated;
      await writeFile(modelsIndexPath, content);
      generated.push(`${dir}/src/models/index.ts (model wired)`);
    }
  }

  const moduleDir = join(cwd, dir, 'src/modules', kebab);
  if (!existsSync(moduleDir)) {
    await mkdir(moduleDir, { recursive: true });
    const routerSource = await fillTemplate(
      repoDir,
      'sequelize',
      framework === 'fastify' ? 'fastify-router.ts' : 'express-router.ts',
      vars,
    );
    await writeFile(join(moduleDir, 'index.ts'), routerSource);
    generated.push(`${dir}/src/modules/${kebab}/index.ts`);
  }

  const appPath = join(cwd, dir, 'src/app.ts');
  if (existsSync(appPath)) {
    let appContent = await readFile(appPath, 'utf-8');
    const importLine = `import { register${vars.ENTITY_PASCAL}Entity } from './modules/${kebab}/index.js';`;
    const registrationLine =
      framework === 'fastify'
        ? `  await register${vars.ENTITY_PASCAL}Entity(app);`
        : `  register${vars.ENTITY_PASCAL}Entity(app);`;
    const updated = insertAtAnchor(
      insertAtAnchor(appContent, 'projx-anchor: entity-imports', importLine),
      'projx-anchor: entity-registrations',
      registrationLine,
    );
    if (updated !== appContent) {
      appContent = updated;
      await writeFile(appPath, appContent);
      generated.push(`${dir}/src/app.ts (entity wired)`);
    }
  }

  const testsDir =
    framework === 'fastify'
      ? join(cwd, dir, 'tests/modules')
      : join(cwd, dir, 'tests');
  await mkdir(testsDir, { recursive: true });
  const testFile = join(testsDir, `${kebab}.test.ts`);
  if (!existsSync(testFile)) {
    const testSource = await fillTemplate(
      repoDir,
      'sequelize',
      framework === 'fastify' ? 'fastify-test.ts' : 'express-test.ts',
      vars,
    );
    await writeFile(testFile, testSource);
    const testRel =
      framework === 'fastify'
        ? `tests/modules/${kebab}.test.ts`
        : `tests/${kebab}.test.ts`;
    generated.push(`${dir}/${testRel}`);
  }
}

async function appendDrizzleEntity(
  repoDir: string,
  cwd: string,
  dir: string,
  framework: 'fastify' | 'express',
  config: EntityConfig,
  generated: string[],
): Promise<void> {
  const schemaDir = join(cwd, dir, 'src/db');
  const schemaPath = join(schemaDir, 'schema.ts');
  const tableConst = toCamel(pluralize(toPascal(config.name)));
  const tableSource = generateDrizzleTable(config);
  await mkdir(schemaDir, { recursive: true });

  const usedImports = drizzleImports(config);
  if (!existsSync(schemaPath)) {
    await writeFile(
      schemaPath,
      `import { ${usedImports.join(', ')} } from 'drizzle-orm/pg-core';\n\n${tableSource}\n`,
    );
    generated.push(`${dir}/src/db/schema.ts`);
  } else {
    const content = await readFile(schemaPath, 'utf-8');
    if (!content.includes(`export const ${tableConst} = pgTable(`)) {
      let updated = content;
      const importLine = `import { ${usedImports.join(', ')} } from 'drizzle-orm/pg-core';`;
      if (!updated.includes('drizzle-orm/pg-core')) {
        updated = importLine + '\n\n' + updated;
      } else {
        updated = updated.replace(
          /import\s+\{([^}]+)\}\s+from\s+'drizzle-orm\/pg-core';/,
          (_match, imports: string) => {
            const names = new Set(
              String(imports)
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            );
            for (const name of usedImports) {
              names.add(name);
            }
            return `import { ${[...names].sort().join(', ')} } from 'drizzle-orm/pg-core';`;
          },
        );
      }
      await writeFile(
        schemaPath,
        updated.trimEnd() + '\n\n' + tableSource + '\n',
      );
      generated.push(`${dir}/src/db/schema.ts (table added)`);
    }
  }

  const vars = buildDrizzleEntityVars(config);
  const kebab = toKebab(config.name);
  const moduleDir = join(cwd, dir, 'src/modules', kebab);

  if (!existsSync(moduleDir)) {
    await mkdir(moduleDir, { recursive: true });
    const routerSource = await fillTemplate(
      repoDir,
      'drizzle',
      framework === 'fastify' ? 'fastify-router.ts' : 'express-router.ts',
      vars,
    );
    await writeFile(join(moduleDir, 'index.ts'), routerSource);
    generated.push(`${dir}/src/modules/${kebab}/index.ts`);
  }

  const appPath = join(cwd, dir, 'src/app.ts');
  if (existsSync(appPath)) {
    let appContent = await readFile(appPath, 'utf-8');
    const importLine = `import { register${vars.ENTITY_PASCAL}Entity } from './modules/${kebab}/index.js';`;
    const registrationLine =
      framework === 'fastify'
        ? `  await register${vars.ENTITY_PASCAL}Entity(app);`
        : `  register${vars.ENTITY_PASCAL}Entity(app, db);`;
    const updated = insertAtAnchor(
      insertAtAnchor(appContent, 'projx-anchor: entity-imports', importLine),
      'projx-anchor: entity-registrations',
      registrationLine,
    );
    if (updated !== appContent) {
      appContent = updated;
      await writeFile(appPath, appContent);
      generated.push(`${dir}/src/app.ts (entity wired)`);
    }
  }

  const testsDir =
    framework === 'fastify'
      ? join(cwd, dir, 'tests/modules')
      : join(cwd, dir, 'tests');
  await mkdir(testsDir, { recursive: true });
  const testFile = join(testsDir, `${kebab}.test.ts`);
  if (!existsSync(testFile)) {
    const testSource = await fillTemplate(
      repoDir,
      'drizzle',
      framework === 'fastify' ? 'fastify-test.ts' : 'express-test.ts',
      vars,
    );
    await writeFile(testFile, testSource);
    const testRel =
      framework === 'fastify'
        ? `tests/modules/${kebab}.test.ts`
        : `tests/${kebab}.test.ts`;
    generated.push(`${dir}/${testRel}`);
  }
}

// --- Go (GORM) generation ---

function goFieldType(type: FieldType): string {
  switch (type) {
    case 'string':
    case 'text':
      return 'string';
    case 'number':
      return 'int';
    case 'boolean':
      return 'bool';
    case 'date':
    case 'datetime':
      return 'entities.JSONTime';
    case 'json':
      return 'json.RawMessage';
  }
}

function goJsonTag(name: string, required: boolean): string {
  return required ? `"${name}"` : `"${name},omitempty"`;
}

function goGormTag(field: EntityField): string {
  const parts: string[] = [];
  if (field.required) parts.push('not null');
  if (field.unique) parts.push('uniqueIndex');
  return parts.join(';');
}

function maxFieldWidth(names: string[]): number {
  return names.reduce((acc, n) => Math.max(acc, n.length), 0);
}

function generateGoModel(
  config: EntityConfig,
  gomod: string,
  pkg: string,
): string {
  const className = toPascal(config.name);

  interface GoField {
    name: string;
    type: string;
    gormTag: string;
    jsonName: string;
    required: boolean;
  }

  const goFields: GoField[] = [
    {
      name: 'ID',
      type: 'string',
      gormTag: 'primaryKey;type:uuid',
      jsonName: 'id',
      required: true,
    },
    ...config.fields.map((f) => ({
      name: toPascal(f.name),
      type: goFieldType(f.type),
      gormTag: goGormTag(f),
      jsonName: f.name,
      required: f.required,
    })),
    {
      name: 'CreatedAt',
      type: 'time.Time',
      gormTag: '',
      jsonName: 'created_at',
      required: true,
    },
    {
      name: 'UpdatedAt',
      type: 'time.Time',
      gormTag: '',
      jsonName: 'updated_at',
      required: true,
    },
  ];

  if (config.softDelete) {
    goFields.push({
      name: 'DeletedAt',
      type: 'gorm.DeletedAt',
      gormTag: 'index',
      jsonName: '-',
      required: false,
    });
  }

  const nameW = maxFieldWidth(goFields.map((f) => f.name));
  const typeW = maxFieldWidth(goFields.map((f) => f.type));

  const usesJson = config.fields.some((f) => f.type === 'json');
  const usesTime = goFields.some((f) => f.type === 'time.Time');

  const stdImports: string[] = [];
  if (usesJson) stdImports.push('"encoding/json"');
  if (usesTime) stdImports.push('"time"');

  const lines: string[] = [];
  lines.push(`package ${pkg}`);
  lines.push('');
  lines.push('import (');
  for (const imp of stdImports) {
    lines.push(`\t${imp}`);
  }
  if (stdImports.length > 0) lines.push('');
  lines.push('\t"gorm.io/gorm"');
  lines.push('');
  lines.push(`\t"${gomod}/internal/entities"`);
  lines.push(`\t"${gomod}/internal/uuid"`);
  lines.push(')');
  lines.push('');
  lines.push(`type ${className} struct {`);

  for (const f of goFields) {
    const tagParts: string[] = [];
    if (f.gormTag) tagParts.push(`gorm:"${f.gormTag}"`);
    tagParts.push(
      `json:${f.jsonName === '-' ? '"-"' : goJsonTag(f.jsonName, f.required)}`,
    );
    const tag = tagParts.join(' ');
    lines.push(`\t${f.name.padEnd(nameW)} ${f.type.padEnd(typeW)} \`${tag}\``);
  }
  lines.push('}');
  lines.push('');
  lines.push(`func (m *${className}) BeforeCreate(_ *gorm.DB) error {`);
  lines.push('\tif m.ID == "" {');
  lines.push('\t\tm.ID = uuid.V4()');
  lines.push('\t}');
  lines.push('\treturn nil');
  lines.push('}');
  lines.push('');
  lines.push('func Config() entities.EntityConfig {');
  lines.push('\treturn entities.EntityConfig{');
  lines.push(`\t\tName:             "${toSnake(config.name)}",`);
  lines.push(`\t\tModel:            &${className}{},`);
  lines.push(`\t\tBasePath:         "${config.apiPrefix}",`);
  if (config.searchableFields.length > 0) {
    const fields = config.searchableFields.map((f) => `"${f}"`).join(', ');
    lines.push(`\t\tSearchableFields: []string{${fields}},`);
  } else {
    lines.push('\t\tSearchableFields: []string{},');
  }
  lines.push(`\t\tSoftDelete:       ${String(config.softDelete)},`);
  lines.push('\t}');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function generateGoTest(config: EntityConfig, pkg: string): string {
  const className = toPascal(config.name);
  const lines: string[] = [];

  lines.push(`package ${pkg}`);
  lines.push('');
  lines.push('import (');
  lines.push('\t"testing"');
  lines.push('');
  lines.push('\t"github.com/stretchr/testify/assert"');
  lines.push('\t"github.com/stretchr/testify/require"');
  lines.push(')');
  lines.push('');
  lines.push('func TestConfigShape(t *testing.T) {');
  lines.push('\tcfg := Config()');
  lines.push(`\tassert.Equal(t, "${toSnake(config.name)}", cfg.Name)`);
  lines.push(`\tassert.Equal(t, "${config.apiPrefix}", cfg.BasePath)`);
  lines.push(`\tassert.Equal(t, ${String(config.softDelete)}, cfg.SoftDelete)`);
  lines.push('\trequire.NotNil(t, cfg.Model)');
  lines.push(`\t_, ok := cfg.Model.(*${className})`);
  lines.push(`\tassert.True(t, ok, "Model must be a *${className}")`);
  lines.push('}');
  lines.push('');
  lines.push('func TestBeforeCreateAssignsIDWhenEmpty(t *testing.T) {');
  lines.push(`\tm := &${className}{}`);
  lines.push('\trequire.NoError(t, m.BeforeCreate(nil))');
  lines.push('\tassert.NotEmpty(t, m.ID)');
  lines.push('\tassert.Len(t, m.ID, 36)');
  lines.push('}');
  lines.push('');
  lines.push('func TestBeforeCreatePreservesExistingID(t *testing.T) {');
  lines.push(`\tm := &${className}{ID: "preset-id"}`);
  lines.push('\trequire.NoError(t, m.BeforeCreate(nil))');
  lines.push('\tassert.Equal(t, "preset-id", m.ID)');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

async function readGoModule(goDir: string): Promise<string> {
  const path = join(goDir, 'go.mod');
  if (!existsSync(path)) {
    throw new Error(`go.mod not found at ${path}`);
  }
  const content = await readFile(path, 'utf-8');
  const match = content.match(/^\s*module\s+(\S+)\s*$/m);
  if (!match) {
    throw new Error(`Could not parse module path from ${path}`);
  }
  return match[1];
}

async function appendGoEntity(
  cwd: string,
  dir: string,
  config: EntityConfig,
  generated: string[],
): Promise<void> {
  const goDir = join(cwd, dir);
  const gomod = await readGoModule(goDir);
  const pkg = toSnake(config.name);
  const fileBase = toSnake(config.name);

  const entityDir = join(goDir, 'internal', pkg);
  const modelPath = join(entityDir, `${fileBase}.go`);
  const testPath = join(entityDir, `${fileBase}_test.go`);

  if (!existsSync(modelPath)) {
    await mkdir(entityDir, { recursive: true });
    await writeFile(modelPath, generateGoModel(config, gomod, pkg));
    generated.push(`${dir}/internal/${pkg}/${fileBase}.go`);
  }

  if (!existsSync(testPath)) {
    await mkdir(entityDir, { recursive: true });
    await writeFile(testPath, generateGoTest(config, pkg));
    generated.push(`${dir}/internal/${pkg}/${fileBase}_test.go`);
  }

  const mainPath = join(goDir, 'main.go');
  if (existsSync(mainPath)) {
    let mainContent = await readFile(mainPath, 'utf-8');
    const importLine = `\t"${gomod}/internal/${pkg}"`;
    const registrationLine = `\tentities.Register(${pkg}.Config())`;
    const updated = insertAtAnchor(
      insertAtAnchor(mainContent, 'projx-anchor: entity-imports', importLine),
      'projx-anchor: entity-registrations',
      registrationLine,
    );
    if (updated !== mainContent) {
      mainContent = updated;
      await writeFile(mainPath, mainContent);
      generated.push(`${dir}/main.go (entity wired)`);
    }
  }
}

interface SqlcEntityVars extends Record<string, string> {
  ENTITY_PASCAL: string;
  ENTITY_SNAKE: string;
  API_PREFIX: string;
  TABLE_NAME: string;
  COLUMNS_ARRAY: string;
  UPDATABLE_COLUMNS_ARRAY: string;
  SEARCHABLE_FIELDS_ARRAY: string;
  SOFT_DELETE: string;
  SOFT_DELETE_FILTER: string;
  SOFT_DELETE_FILTER_AND: string;
  SOFT_DELETE_LIST_BLOCK: string;
  SELECT_COLS: string;
  SELECT_COLS_STR: string;
  STRUCT_FIELDS: string;
  CREATE_INPUT_FIELDS: string;
  CREATE_VALIDATION: string;
  INSERT_COLUMNS: string;
  INSERT_PLACEHOLDERS: string;
  INSERT_VALUES: string;
  SCAN_ARGS: string;
  SEARCH_CLAUSES: string;
  FILTER_BLOCK: string;
  DELETE_BODY: string;
  BULK_DELETE_BODY: string;
  MIGRATION_COLUMNS: string;
  SOFT_DELETE_COLUMN: string;
  SOFT_DELETE_INDEX: string;
}

function sqlcGoType(field: EntityField): string {
  const optional = !field.required;
  switch (field.type) {
    case 'string':
    case 'text':
      return optional ? 'sql.NullString' : 'string';
    case 'number':
      return optional ? 'sql.NullInt64' : 'int64';
    case 'boolean':
      return optional ? 'sql.NullBool' : 'bool';
    case 'date':
    case 'datetime':
      return optional ? 'sql.NullTime' : 'time.Time';
    case 'json':
      return 'entities.JSON';
  }
}

function sqlcInputGoType(field: EntityField): string {
  switch (field.type) {
    case 'string':
    case 'text':
      return field.required ? 'string' : '*string';
    case 'number':
      return field.required ? 'int64' : '*int64';
    case 'boolean':
      return field.required ? 'bool' : '*bool';
    case 'date':
    case 'datetime':
      return field.required ? 'entities.JSONTime' : '*entities.JSONTime';
    case 'json':
      return field.required ? 'entities.JSON' : '*entities.JSON';
    default:
      return assertNeverFieldType(field.type);
  }
}

function sqlcSqlType(field: EntityField): string {
  switch (field.type) {
    case 'string':
      return 'VARCHAR(255)';
    case 'text':
      return 'TEXT';
    case 'number':
      return 'BIGINT';
    case 'boolean':
      return 'BOOLEAN';
    case 'date':
      return 'DATE';
    case 'datetime':
      return 'TIMESTAMPTZ';
    case 'json':
      return 'JSONB';
  }
}

function buildSqlcEntityVars(config: EntityConfig): SqlcEntityVars {
  const pascal = toPascal(config.name);
  const snake = toSnake(config.name);
  const tableName = config.tableName;

  const allCols = [
    'id',
    ...config.fields.map((f) => f.name),
    'created_at',
    'updated_at',
  ];
  if (config.softDelete) allCols.push('deleted_at');

  const updatableCols = config.fields
    .filter((f) => !f.generated)
    .map((f) => f.name);

  const colsArr = allCols.map((c) => `"${c}"`).join(', ');
  const updArr = updatableCols.map((c) => `"${c}"`).join(', ');
  const searchArr = config.searchableFields.map((f) => `"${f}"`).join(', ');

  const softDeleteFilter = config.softDelete ? ' AND deleted_at IS NULL' : '';
  const softDeleteFilterAnd = config.softDelete
    ? ' AND deleted_at IS NULL'
    : '';
  const softDeleteListBlock = config.softDelete
    ? `\tif !p.IncludeDeleted {\n\t\twhere = append(where, "deleted_at IS NULL")\n\t}`
    : '';

  const selectCols = allCols.join(', ');

  const structFieldLines: string[] = [`\tID string \`json:"id"\``];
  for (const f of config.fields) {
    structFieldLines.push(
      `\t${toPascal(f.name)} ${sqlcGoType(f)} \`json:"${f.name}"\``,
    );
  }
  const structFields = structFieldLines.join('\n');

  const createInputFields = config.fields
    .filter((f) => !f.generated)
    .map((f) => {
      const t = sqlcInputGoType(f);
      const tag = `\`json:"${f.name}"\``;
      return `\t${toPascal(f.name)} ${t} ${tag}`;
    })
    .join('\n');

  const createValidation = config.fields
    .filter(
      (f) =>
        f.required &&
        !f.generated &&
        (f.type === 'string' || f.type === 'text'),
    )
    .map((f) => {
      const goName = toPascal(f.name);
      return `\tif strings.TrimSpace(in.${goName}) == "" {\n\t\treturn nil, apperr.Validation("field '${f.name}' is required")\n\t}`;
    })
    .join('\n');

  const insertCols = [
    'id',
    ...config.fields.filter((f) => !f.generated).map((f) => f.name),
    'created_at',
    'updated_at',
  ];
  const insertPlaceholders = insertCols
    .map((_, i) => (i < insertCols.length - 2 ? `$${i + 1}` : 'NOW()'))
    .join(', ');
  const insertValues = [
    'id',
    ...config.fields
      .filter((f) => !f.generated)
      .map((f) => `in.${toPascal(f.name)}`),
  ].join(', ');

  const scanArgs = allCols
    .map((c) => {
      if (c === 'id') return '&rec.ID';
      if (c === 'created_at') return '&rec.CreatedAt';
      if (c === 'updated_at') return '&rec.UpdatedAt';
      if (c === 'deleted_at') return '&rec.DeletedAt';
      return `&rec.${toPascal(c)}`;
    })
    .join(', ');

  const searchClauses =
    config.searchableFields.length > 0
      ? '[]string{' +
        config.searchableFields
          .map((f, i) => `fmt.Sprintf("${f} ILIKE $%d", idx+${i})`)
          .join(', ') +
        '}'
      : '[]string{}';

  const filterableCols = allCols.filter(
    (c) =>
      c !== 'id' &&
      c !== 'created_at' &&
      c !== 'updated_at' &&
      c !== 'deleted_at',
  );
  const filterCases = filterableCols.map((c) => `\t\tcase "${c}":`).join('\n');
  const filterBlock =
    filterableCols.length > 0
      ? `\tfor col, val := range p.Filters {
\t\tswitch col {
${filterCases}
\t\tdefault:
\t\t\tcontinue
\t\t}
\t\twhere = append(where, fmt.Sprintf("%s::text = $%d", col, idx))
\t\targs = append(args, val)
\t\tidx++
\t}`
      : '';

  const deleteBody = config.softDelete
    ? `\tres, err := q.pool.ExecContext(ctx, \`UPDATE \`+tableName+\` SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL\`, id)
\tif err != nil {
\t\treturn err
\t}
\tn, _ := res.RowsAffected()
\tif n == 0 {
\t\treturn apperr.NotFound("${snake}")
\t}
\treturn nil`
    : `\tres, err := q.pool.ExecContext(ctx, \`DELETE FROM \`+tableName+\` WHERE id = $1\`, id)
\tif err != nil {
\t\treturn err
\t}
\tn, _ := res.RowsAffected()
\tif n == 0 {
\t\treturn apperr.NotFound("${snake}")
\t}
\treturn nil`;

  const bulkDeleteBody = config.softDelete
    ? `\tres, err := q.pool.ExecContext(ctx, \`UPDATE \`+tableName+\` SET deleted_at = NOW() WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL\`, ids)
\tif err != nil {
\t\treturn 0, err
\t}
\tn, _ := res.RowsAffected()
\treturn int(n), nil`
    : `\tres, err := q.pool.ExecContext(ctx, \`DELETE FROM \`+tableName+\` WHERE id = ANY($1::uuid[])\`, ids)
\tif err != nil {
\t\treturn 0, err
\t}
\tn, _ := res.RowsAffected()
\treturn int(n), nil`;

  const migrationCols = config.fields
    .map((f) => {
      const nullable = f.required ? ' NOT NULL' : '';
      const uniq = f.unique ? ' UNIQUE' : '';
      return `    ${f.name.padEnd(12)}${sqlcSqlType(f)}${nullable}${uniq},`;
    })
    .join('\n');

  const softDeleteColumn = config.softDelete
    ? ',\n    deleted_at  TIMESTAMPTZ'
    : '';
  const softDeleteIndex = config.softDelete
    ? `CREATE INDEX IF NOT EXISTS ${tableName}_deleted_at_idx ON ${tableName} (deleted_at);`
    : '';

  return {
    ENTITY_PASCAL: pascal,
    ENTITY_SNAKE: snake,
    API_PREFIX: config.apiPrefix,
    TABLE_NAME: tableName,
    COLUMNS_ARRAY: colsArr,
    UPDATABLE_COLUMNS_ARRAY: updArr,
    SEARCHABLE_FIELDS_ARRAY: searchArr,
    SOFT_DELETE: String(config.softDelete),
    SOFT_DELETE_FILTER: softDeleteFilter,
    SOFT_DELETE_FILTER_AND: softDeleteFilterAnd,
    SOFT_DELETE_LIST_BLOCK: softDeleteListBlock,
    SELECT_COLS: selectCols,
    SELECT_COLS_STR: selectCols,
    STRUCT_FIELDS: structFields,
    CREATE_INPUT_FIELDS: createInputFields,
    CREATE_VALIDATION: createValidation,
    INSERT_COLUMNS: insertCols.join(', '),
    INSERT_PLACEHOLDERS: insertPlaceholders,
    INSERT_VALUES: insertValues,
    SCAN_ARGS: scanArgs,
    SEARCH_CLAUSES: searchClauses,
    FILTER_BLOCK: filterBlock,
    DELETE_BODY: deleteBody,
    BULK_DELETE_BODY: bulkDeleteBody,
    MIGRATION_COLUMNS: migrationCols,
    SOFT_DELETE_COLUMN: softDeleteColumn,
    SOFT_DELETE_INDEX: softDeleteIndex,
  };
}

interface EntEntityVars extends Record<string, string> {
  ENTITY_PASCAL: string;
  ENTITY_SNAKE: string;
  API_PREFIX: string;
  TABLE_NAME: string;
  COLUMNS_ARRAY: string;
  UPDATABLE_COLUMNS_ARRAY: string;
  SEARCHABLE_FIELDS_ARRAY: string;
  SOFT_DELETE: string;
  ENT_PKG: string;
  ENT_PKG_IMPORT: string;
  MIXIN_LIST: string;
  SCHEMA_FIELDS: string;
  SCHEMA_INDEXES: string;
  CREATE_INPUT_FIELDS: string;
  CREATE_VALIDATION: string;
  CREATE_SETTERS: string;
  UPDATE_SETTERS: string;
  GET_SOFT_DELETE_FILTER: string;
  LIST_SOFT_DELETE_BLOCK: string;
  UPDATE_SOFT_DELETE_FILTER: string;
  SEARCH_BLOCK: string;
  FILTER_BLOCK: string;
  DELETE_BODY: string;
  BULK_DELETE_BODY: string;
}

function entSchemaFieldExpr(field: EntityField): string {
  const fname = field.name;
  let base: string;
  switch (field.type) {
    case 'string':
      base = `field.String("${fname}")`;
      if (field.required) base += '.NotEmpty()';
      break;
    case 'text':
      base = `field.Text("${fname}")`;
      break;
    case 'number':
      base = `field.Int("${fname}")`;
      break;
    case 'boolean':
      base = `field.Bool("${fname}").Default(false)`;
      break;
    case 'date':
    case 'datetime':
      base = `field.Time("${fname}")`;
      break;
    case 'json':
      base = `field.JSON("${fname}", map[string]any{})`;
      break;
  }
  if (!field.required) {
    base += field.type === 'json' ? '.Optional()' : '.Optional().Nillable()';
  }
  if (field.unique) base += '.Unique()';
  return `\t\t${base},`;
}

function entCreateInputField(field: EntityField): string {
  const goName = toPascal(field.name);
  const jsonTag = `\`json:"${field.name}"\``;
  let goType: string;
  switch (field.type) {
    case 'string':
    case 'text':
      goType = field.required ? 'string' : '*string';
      break;
    case 'number':
      goType = field.required ? 'int' : '*int';
      break;
    case 'boolean':
      goType = field.required ? 'bool' : '*bool';
      break;
    case 'date':
    case 'datetime':
      goType = field.required ? 'entities.JSONTime' : '*entities.JSONTime';
      break;
    case 'json':
      goType = 'map[string]any';
      break;
  }
  return `\t${goName} ${goType} ${jsonTag}`;
}

function entCreateValidation(fields: EntityField[]): string {
  const lines: string[] = [];
  for (const f of fields) {
    if (!f.required || f.generated) continue;
    const goName = toPascal(f.name);
    if (f.type === 'string' || f.type === 'text') {
      lines.push(`\tif strings.TrimSpace(in.${goName}) == "" {`);
      lines.push(
        `\t\treturn nil, apperr.Validation("field '${f.name}' is required")`,
      );
      lines.push(`\t}`);
    }
  }
  return lines.join('\n');
}

function entCreateSetter(field: EntityField): string {
  const goName = toPascal(field.name);
  if (field.type === 'date' || field.type === 'datetime') {
    return field.required
      ? `\t\tSet${goName}(in.${goName}.Time).`
      : `\t\tSetNillable${goName}(in.${goName}.TimePtr()).`;
  }
  if (field.required || field.type === 'json') {
    return `\t\tSet${goName}(in.${goName}).`;
  }
  return `\t\tSetNillable${goName}(in.${goName}).`;
}

function entUpdateSetter(field: EntityField): string {
  const goName = toPascal(field.name);
  if (field.type === 'date' || field.type === 'datetime') {
    return [
      `\tif v, ok := patch["${field.name}"]; ok {`,
      `\t\tif s, ok := v.(string); ok {`,
      `\t\t\tif parsed, perr := entities.ParseTime(s); perr == nil {`,
      `\t\t\t\tupd = upd.Set${goName}(parsed)`,
      `\t\t\t}`,
      `\t\t}`,
      `\t}`,
    ].join('\n');
  }
  if (field.type === 'json') {
    return [
      `\tif v, ok := patch["${field.name}"]; ok {`,
      `\t\tif m, ok := v.(map[string]any); ok {`,
      `\t\t\tupd = upd.Set${goName}(m)`,
      `\t\t}`,
      `\t}`,
    ].join('\n');
  }
  let cast: string;
  switch (field.type) {
    case 'string':
    case 'text':
      cast = 'string';
      break;
    case 'number':
      cast = 'int';
      break;
    case 'boolean':
      cast = 'bool';
      break;
    default:
      return assertNeverFieldType(field.type);
  }
  if (cast === 'int') {
    return [
      `\tif v, ok := patch["${field.name}"]; ok {`,
      `\t\tswitch n := v.(type) {`,
      `\t\tcase float64:`,
      `\t\t\tupd = upd.Set${goName}(int(n))`,
      `\t\tcase int:`,
      `\t\t\tupd = upd.Set${goName}(n)`,
      `\t\t}`,
      `\t}`,
    ].join('\n');
  }
  return [
    `\tif v, ok := patch["${field.name}"]; ok {`,
    `\t\tif s, ok := v.(${cast}); ok {`,
    `\t\t\tupd = upd.Set${goName}(s)`,
    `\t\t}`,
    `\t}`,
  ].join('\n');
}

function buildEntEntityVars(
  config: EntityConfig,
  gomod: string,
): EntEntityVars {
  const pascal = toPascal(config.name);
  const snake = toSnake(config.name);
  const tableName = config.tableName;
  const entPkg = snake;
  const entPkgImport = `"${gomod}/ent/${entPkg}"`;

  const allCols = [
    'id',
    ...config.fields.map((f) => f.name),
    'created_at',
    'updated_at',
  ];
  if (config.softDelete) allCols.push('deleted_at');

  const updatableCols = config.fields
    .filter((f) => !f.generated)
    .map((f) => f.name);

  const colsArr = allCols.map((c) => `"${c}"`).join(', ');
  const updArr = updatableCols.map((c) => `"${c}"`).join(', ');
  const searchArr = config.searchableFields.map((f) => `"${f}"`).join(', ');

  const schemaFields = config.fields.map(entSchemaFieldExpr).join('\n');
  const schemaIndexes =
    config.searchableFields.length > 0
      ? config.searchableFields
          .map((f) => `\t\tindex.Fields("${f}"),`)
          .join('\n')
      : '';

  const mixinList = config.softDelete ? '\t\tSoftDeleteMixin{},' : '';

  const createInputFields = config.fields
    .filter((f) => !f.generated)
    .map(entCreateInputField)
    .join('\n');

  const createValidation = entCreateValidation(config.fields);

  const createSetters = config.fields
    .filter((f) => !f.generated)
    .map(entCreateSetter)
    .join('\n');

  const updateSetters = updatableCols
    .map((col) => {
      const f = config.fields.find((field) => field.name === col);
      return f ? entUpdateSetter(f) : '';
    })
    .filter(Boolean)
    .join('\n');

  const getSoftDeleteFilter = config.softDelete
    ? `\tqry = qry.Where(${entPkg}.DeletedAtIsNil())`
    : '';

  const listSoftDeleteBlock = config.softDelete
    ? `\tif !p.IncludeDeleted {\n\t\tqry = qry.Where(${entPkg}.DeletedAtIsNil())\n\t}`
    : '';

  const updateSoftDeleteFilter = config.softDelete
    ? `\tupd = upd.Where(${entPkg}.DeletedAtIsNil())`
    : '';

  const searchClauses = config.searchableFields
    .map((f) => `${entPkg}.${toPascal(f)}ContainsFold(needle)`)
    .join(', ');
  const searchBlock =
    config.searchableFields.length > 0
      ? `\tif p.Search != "" {\n\t\tneedle := "%" + p.Search + "%"\n\t\tqry = qry.Where(${entPkg}.Or(${searchClauses}))\n\t}`
      : '';

  const entFilterableCols = config.fields
    .filter((f) => !f.generated)
    .filter(
      (f) =>
        f.type === 'string' ||
        f.type === 'text' ||
        f.type === 'number' ||
        f.type === 'boolean',
    );
  const entFilterCases = entFilterableCols
    .map((f) => {
      const pf = toPascal(f.name);
      if (f.type === 'boolean') {
        return `\t\tcase "${f.name}":\n\t\t\tqry = qry.Where(${entPkg}.${pf}(val == "true"))`;
      }
      if (f.type === 'number') {
        return `\t\tcase "${f.name}":\n\t\t\tvar n int\n\t\t\tif err := json.Unmarshal([]byte(val), &n); err == nil {\n\t\t\t\tqry = qry.Where(${entPkg}.${pf}(n))\n\t\t\t}`;
      }
      return `\t\tcase "${f.name}":\n\t\t\tqry = qry.Where(${entPkg}.${pf}(val))`;
    })
    .join('\n');
  const filterBlock =
    entFilterCases.length > 0
      ? `\tfor col, val := range p.Filters {\n\t\tswitch col {\n${entFilterCases}\n\t\t}\n\t}`
      : '';

  const deleteBody = config.softDelete
    ? `\tnow := time.Now()\n\tn, err := q.client.${pascal}.Update().\n\t\tWhere(${entPkg}.ID(id), ${entPkg}.DeletedAtIsNil()).\n\t\tSetDeletedAt(now).\n\t\tSave(ctx)\n\tif err != nil {\n\t\treturn err\n\t}\n\tif n == 0 {\n\t\treturn apperr.NotFound("${snake}")\n\t}\n\treturn nil`
    : `\terr := q.client.${pascal}.DeleteOneID(id).Exec(ctx)\n\tif err != nil {\n\t\tif ent.IsNotFound(err) {\n\t\t\treturn apperr.NotFound("${snake}")\n\t\t}\n\t\treturn err\n\t}\n\treturn nil`;

  const bulkDeleteBody = config.softDelete
    ? `\tnow := time.Now()\n\tn, err := q.client.${pascal}.Update().\n\t\tWhere(${entPkg}.IDIn(ids...), ${entPkg}.DeletedAtIsNil()).\n\t\tSetDeletedAt(now).\n\t\tSave(ctx)\n\tif err != nil {\n\t\treturn 0, err\n\t}\n\treturn n, nil`
    : `\tn, err := q.client.${pascal}.Delete().Where(${entPkg}.IDIn(ids...)).Exec(ctx)\n\tif err != nil {\n\t\treturn 0, err\n\t}\n\treturn n, nil`;

  return {
    ENTITY_PASCAL: pascal,
    ENTITY_SNAKE: snake,
    API_PREFIX: config.apiPrefix,
    TABLE_NAME: tableName,
    COLUMNS_ARRAY: colsArr,
    UPDATABLE_COLUMNS_ARRAY: updArr,
    SEARCHABLE_FIELDS_ARRAY: searchArr,
    SOFT_DELETE: String(config.softDelete),
    ENT_PKG: entPkg,
    ENT_PKG_IMPORT: entPkgImport,
    MIXIN_LIST: mixinList,
    SCHEMA_FIELDS: schemaFields,
    SCHEMA_INDEXES: schemaIndexes,
    CREATE_INPUT_FIELDS: createInputFields,
    CREATE_VALIDATION: createValidation,
    CREATE_SETTERS: createSetters,
    UPDATE_SETTERS: updateSetters,
    GET_SOFT_DELETE_FILTER: getSoftDeleteFilter,
    LIST_SOFT_DELETE_BLOCK: listSoftDeleteBlock,
    UPDATE_SOFT_DELETE_FILTER: updateSoftDeleteFilter,
    SEARCH_BLOCK: searchBlock,
    FILTER_BLOCK: filterBlock,
    DELETE_BODY: deleteBody,
    BULK_DELETE_BODY: bulkDeleteBody,
  };
}

async function appendEntEntity(
  repoDir: string,
  cwd: string,
  dir: string,
  config: EntityConfig,
  generated: string[],
): Promise<void> {
  const goDir = join(cwd, dir);
  const gomod = await readGoModule(goDir);
  const vars = buildEntEntityVars(config, gomod);
  const pkg = vars.ENTITY_SNAKE;

  const schemaDir = join(goDir, 'ent', 'schema');
  await mkdir(schemaDir, { recursive: true });
  const schemaPath = join(schemaDir, `${pkg}.go`);
  if (!existsSync(schemaPath)) {
    const schemaSource = await fillTemplate(repoDir, 'ent', 'schema.go', vars);
    await writeFile(schemaPath, schemaSource);
    generated.push(`${dir}/ent/schema/${pkg}.go`);
  }

  const entityDir = join(goDir, 'internal', pkg);
  await mkdir(entityDir, { recursive: true });

  const adapterPath = join(entityDir, `${pkg}.go`);
  if (!existsSync(adapterPath)) {
    const adapterSource = await fillTemplate(
      repoDir,
      'ent',
      'entity_adapter.go',
      vars,
    );
    await writeFile(adapterPath, adapterSource);
    generated.push(`${dir}/internal/${pkg}/${pkg}.go`);
  }

  const testPath = join(entityDir, `${pkg}_test.go`);
  if (!existsSync(testPath)) {
    const testSource = await fillTemplate(
      repoDir,
      'ent',
      'entity_test.go',
      vars,
    );
    await writeFile(testPath, testSource);
    generated.push(`${dir}/internal/${pkg}/${pkg}_test.go`);
  }

  const mainPath = join(goDir, 'main.go');
  if (existsSync(mainPath)) {
    let mainContent = await readFile(mainPath, 'utf-8');
    const importLine = `\t"${gomod}/internal/${pkg}"`;
    const registrationLine = `\tentities.Register(${pkg}.Config(handles.Client))`;
    const updated = insertAtAnchor(
      insertAtAnchor(mainContent, 'projx-anchor: entity-imports', importLine),
      'projx-anchor: entity-registrations',
      registrationLine,
    );
    if (updated !== mainContent) {
      mainContent = updated;
      await writeFile(mainPath, mainContent);
      generated.push(`${dir}/main.go (entity wired)`);
    }
  }
}

async function appendSqlcEntity(
  repoDir: string,
  cwd: string,
  dir: string,
  config: EntityConfig,
  generated: string[],
): Promise<void> {
  const vars = buildSqlcEntityVars(config);
  const goDir = join(cwd, dir);
  const gomod = await readGoModule(goDir);
  const pkg = vars.ENTITY_SNAKE;

  const entityDir = join(goDir, 'internal', pkg);
  await mkdir(entityDir, { recursive: true });

  const sqlPath = join(entityDir, `${pkg}.sql`);
  if (!existsSync(sqlPath)) {
    const sqlSource = await fillTemplate(repoDir, 'sqlc', 'entity.sql', vars);
    await writeFile(sqlPath, sqlSource);
    generated.push(`${dir}/internal/${pkg}/${pkg}.sql`);
  }

  const adapterPath = join(entityDir, `${pkg}.go`);
  if (!existsSync(adapterPath)) {
    const adapterSource = await fillTemplate(
      repoDir,
      'sqlc',
      'entity_adapter.go',
      vars,
    );
    await writeFile(adapterPath, adapterSource);
    generated.push(`${dir}/internal/${pkg}/${pkg}.go`);
  }

  const testPath = join(entityDir, `${pkg}_test.go`);
  if (!existsSync(testPath)) {
    const testSource = await fillTemplate(
      repoDir,
      'sqlc',
      'entity_test.go',
      vars,
    );
    await writeFile(testPath, testSource);
    generated.push(`${dir}/internal/${pkg}/${pkg}_test.go`);
  }

  const migrationsDir = join(goDir, 'migrations');
  await mkdir(migrationsDir, { recursive: true });
  const migrationRe = new RegExp(`^\\d+_add_${pkg}\\.up\\.sql$`);
  const existingMigration = (await readdir(migrationsDir)).some((f) =>
    migrationRe.test(f),
  );
  if (!existingMigration) {
    const ts = new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14);
    const upName = `${ts}_add_${pkg}.up.sql`;
    const downName = `${ts}_add_${pkg}.down.sql`;
    const upSrc = await fillTemplate(repoDir, 'sqlc', 'migration.up.sql', vars);
    await writeFile(join(migrationsDir, upName), upSrc);
    generated.push(`${dir}/migrations/${upName}`);
    const downSrc = await fillTemplate(
      repoDir,
      'sqlc',
      'migration.down.sql',
      vars,
    );
    await writeFile(join(migrationsDir, downName), downSrc);
    generated.push(`${dir}/migrations/${downName}`);
  }

  const mainPath = join(goDir, 'main.go');
  if (existsSync(mainPath)) {
    let mainContent = await readFile(mainPath, 'utf-8');
    const importLine = `\t"${gomod}/internal/${pkg}"`;
    const registrationLine = `\tentities.Register(${pkg}.Config(pool))`;
    const updated = insertAtAnchor(
      insertAtAnchor(mainContent, 'projx-anchor: entity-imports', importLine),
      'projx-anchor: entity-registrations',
      registrationLine,
    );
    if (updated !== mainContent) {
      mainContent = updated;
      await writeFile(mainPath, mainContent);
      generated.push(`${dir}/main.go (entity wired)`);
    }
  }
}

// --- Laravel (Eloquent) generation ---

function phpCastType(type: FieldType): string | null {
  switch (type) {
    case 'string':
    case 'text':
      return null;
    case 'number':
      return 'integer';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'json':
      return 'array';
    default:
      return assertNeverFieldType(type);
  }
}

function phpMigrationColumn(field: EntityField): string {
  let expr: string;
  switch (field.type) {
    case 'string':
      expr = `$table->string('${field.name}', 255)`;
      break;
    case 'text':
      expr = `$table->text('${field.name}')`;
      break;
    case 'number':
      expr = `$table->bigInteger('${field.name}')`;
      break;
    case 'boolean':
      expr = `$table->boolean('${field.name}')`;
      break;
    case 'date':
      expr = `$table->date('${field.name}')`;
      break;
    case 'datetime':
      expr = `$table->timestampTz('${field.name}')`;
      break;
    case 'json':
      expr = `$table->jsonb('${field.name}')`;
      break;
    default:
      return assertNeverFieldType(field.type);
  }
  if (!field.required) expr += '->nullable()';
  if (field.unique) expr += '->unique()';
  return expr + ';';
}

function phpSampleLiteral(
  field: EntityField,
  variant: SampleVariant = 'create',
): string {
  switch (field.type) {
    case 'string':
    case 'text':
      return variant === 'create'
        ? "'sample text'"
        : variant === 'update'
          ? "'updated text'"
          : "'alt text'";
    case 'number':
      return variant === 'create' ? '42' : variant === 'update' ? '100' : '7';
    case 'boolean':
      return variant === 'create' ? 'true' : 'false';
    case 'date':
      return variant === 'alt' ? "'2026-02-01'" : "'2026-01-01'";
    case 'datetime':
      return variant === 'alt'
        ? "'2026-02-01T00:00:00+00:00'"
        : "'2026-01-01T00:00:00+00:00'";
    case 'json':
      return '[]';
    default:
      return assertNeverFieldType(field.type);
  }
}

function generateEloquentModel(config: EntityConfig): string {
  const pascal = toPascal(config.name);
  const fillable = config.fields
    .filter((f) => !f.generated)
    .map((f) => `'${f.name}'`);
  const casts = config.fields
    .map((f) => ({ name: f.name, cast: phpCastType(f.type) }))
    .filter((c) => c.cast !== null);
  const updatable = config.fields
    .filter((f) => !f.generated)
    .map((f) => `'${f.name}'`);

  const lines: string[] = [];
  lines.push('<?php');
  lines.push('');
  lines.push('declare(strict_types=1);');
  lines.push('');
  lines.push('namespace App\\Models;');
  lines.push('');
  lines.push('use Illuminate\\Database\\Eloquent\\Concerns\\HasUuids;');
  lines.push('use Illuminate\\Database\\Eloquent\\Model;');
  if (config.softDelete) {
    lines.push('use Illuminate\\Database\\Eloquent\\SoftDeletes;');
  }
  lines.push('');
  lines.push(`final class ${pascal} extends Model`);
  lines.push('{');
  lines.push('    use HasUuids;');
  if (config.softDelete) {
    lines.push('    use SoftDeletes;');
  }
  lines.push('');
  lines.push(`    protected $table = '${config.tableName}';`);
  lines.push('');
  lines.push("    protected $keyType = 'string';");
  lines.push('');
  lines.push('    public $incrementing = false;');
  lines.push('');
  lines.push('    /** @var list<string> */');
  lines.push(`    protected $fillable = [${fillable.join(', ')}];`);
  if (casts.length > 0) {
    lines.push('');
    lines.push('    /** @var array<string, string> */');
    lines.push('    protected $casts = [');
    for (const c of casts) {
      lines.push(`        '${c.name}' => '${c.cast}',`);
    }
    lines.push('    ];');
  }
  lines.push('');
  lines.push('    /**');
  lines.push('     * @return array<int, string>');
  lines.push('     */');
  lines.push('    public static function searchableFields(): array');
  lines.push('    {');
  const searchable = config.searchableFields.map((f) => `'${f}'`).join(', ');
  lines.push(`        return [${searchable}];`);
  lines.push('    }');
  lines.push('');
  lines.push('    /**');
  lines.push('     * @return array<int, string>');
  lines.push('     */');
  lines.push('    public static function updatableColumns(): array');
  lines.push('    {');
  lines.push(`        return [${updatable.join(', ')}];`);
  lines.push('    }');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function generateEloquentMigration(config: EntityConfig): string {
  const lines: string[] = [];
  lines.push('<?php');
  lines.push('');
  lines.push('declare(strict_types=1);');
  lines.push('');
  lines.push('use Illuminate\\Database\\Migrations\\Migration;');
  lines.push('use Illuminate\\Database\\Schema\\Blueprint;');
  lines.push('use Illuminate\\Support\\Facades\\Schema;');
  lines.push('');
  lines.push('return new class extends Migration');
  lines.push('{');
  lines.push('    public function up(): void');
  lines.push('    {');
  lines.push(
    `        Schema::create('${config.tableName}', function (Blueprint $table): void {`,
  );
  lines.push("            $table->uuid('id')->primary();");
  for (const f of config.fields) {
    lines.push(`            ${phpMigrationColumn(f)}`);
  }
  lines.push('            $table->timestamps();');
  if (config.softDelete) {
    lines.push('            $table->softDeletes();');
  }
  lines.push("            $table->index('created_at');");
  for (const sf of config.searchableFields) {
    lines.push(`            $table->index('${sf}');`);
  }
  lines.push('        });');
  lines.push('    }');
  lines.push('');
  lines.push('    public function down(): void');
  lines.push('    {');
  lines.push(`        Schema::dropIfExists('${config.tableName}');`);
  lines.push('    }');
  lines.push('};');
  lines.push('');

  return lines.join('\n');
}

function eloquentRegistrationBlock(config: EntityConfig): string {
  const pascal = toPascal(config.name);
  const snake = toSnake(config.name);
  const lines: string[] = [];
  lines.push('        $registry->register(new EntityConfig(');
  lines.push(`            name: '${snake}',`);
  lines.push(`            baseClass: \\App\\Models\\${pascal}::class,`);
  lines.push(`            basePath: '${config.apiPrefix.replace(/^\//, '')}',`);
  lines.push(
    `            searchableFields: \\App\\Models\\${pascal}::searchableFields(),`,
  );
  lines.push('            hiddenFields: [],');
  lines.push(`            softDelete: ${String(config.softDelete)},`);
  lines.push(
    `            updatableColumns: \\App\\Models\\${pascal}::updatableColumns(),`,
  );
  lines.push('        ));');
  return lines.join('\n');
}

function generateEloquentTest(config: EntityConfig): string {
  const pascal = toPascal(config.name);
  const snake = toSnake(config.name);
  const basePath = config.apiPrefix.replace(/^\//, '');
  const url = `/api/v1/${basePath}`;
  const createEntries = config.fields
    .filter((f) => !f.generated)
    .map((f) => `        '${f.name}' => ${phpSampleLiteral(f, 'create')},`);
  const updateField = config.fields.find(
    (f) => !f.generated && (f.type === 'string' || f.type === 'text'),
  );
  const firstField = config.fields.find((f) => !f.generated);

  const lines: string[] = [];
  lines.push('<?php');
  lines.push('');
  lines.push('declare(strict_types=1);');
  lines.push('');
  lines.push('use App\\Entities\\EntityConfig;');
  lines.push('use App\\Entities\\EntityRegistry;');
  lines.push(`use App\\Models\\${pascal};`);
  lines.push('');
  lines.push('beforeEach(function (): void {');
  lines.push('    EntityRegistry::resetInstance();');
  lines.push('    EntityRegistry::instance()->register(new EntityConfig(');
  lines.push(`        name: '${snake}',`);
  lines.push(`        baseClass: ${pascal}::class,`);
  lines.push(`        basePath: '${basePath}',`);
  lines.push(`        searchableFields: ${pascal}::searchableFields(),`);
  lines.push('        hiddenFields: [],');
  lines.push(`        softDelete: ${String(config.softDelete)},`);
  lines.push(`        updatableColumns: ${pascal}::updatableColumns(),`);
  lines.push('    ));');
  lines.push("    EntityRegistry::instance()->mountRoutes(app('router'));");
  lines.push('});');
  lines.push('');
  lines.push(`it('creates and lists ${snake} records', function (): void {`);
  lines.push('    /** @var Tests\\TestCase $this */');
  lines.push(`    $response = $this->postJson('${url}', [`);
  for (const e of createEntries) lines.push(e);
  lines.push('    ]);');
  lines.push('    $response->assertStatus(201);');
  lines.push('');
  lines.push(`    $list = $this->getJson('${url}');`);
  lines.push('    $list->assertOk();');
  lines.push("    expect($list->json('pagination.total_records'))->toBe(1);");
  lines.push('});');
  lines.push('');
  lines.push(
    `it('shows a ${snake} and 404s for unknown id', function (): void {`,
  );
  lines.push('    /** @var Tests\\TestCase $this */');
  lines.push(`    $created = $this->postJson('${url}', [`);
  for (const e of createEntries) lines.push(e);
  lines.push("    ])->json('data');");
  lines.push('');
  lines.push(`    $this->getJson('${url}/'.$created['id'])`);
  lines.push('        ->assertOk()');
  lines.push("        ->assertJsonPath('id', $created['id']);");
  lines.push('');
  lines.push(
    `    $this->getJson('${url}/00000000-0000-0000-0000-000000000000')`,
  );
  lines.push('        ->assertNotFound();');
  lines.push('});');
  if (updateField) {
    lines.push('');
    lines.push(`it('updates a ${snake} record', function (): void {`);
    lines.push('    /** @var Tests\\TestCase $this */');
    lines.push(`    $created = $this->postJson('${url}', [`);
    for (const e of createEntries) lines.push(e);
    lines.push("    ])->json('data');");
    lines.push('');
    lines.push(`    $response = $this->patchJson('${url}/'.$created['id'], [`);
    lines.push(
      `        '${updateField.name}' => ${phpSampleLiteral(updateField, 'update')},`,
    );
    lines.push('    ]);');
    lines.push('    $response->assertOk();');
    lines.push(
      `    $response->assertJsonPath('${updateField.name}', ${phpSampleLiteral(updateField, 'update')});`,
    );
    lines.push('});');
  }
  lines.push('');
  lines.push(
    `it('deletes a ${snake} record and 404s afterwards', function (): void {`,
  );
  lines.push('    /** @var Tests\\TestCase $this */');
  lines.push(`    $created = $this->postJson('${url}', [`);
  for (const e of createEntries) lines.push(e);
  lines.push("    ])->json('data');");
  lines.push('');
  lines.push(
    `    $this->deleteJson('${url}/'.$created['id'])->assertNoContent();`,
  );
  lines.push(`    $this->getJson('${url}/'.$created['id'])->assertNotFound();`);
  lines.push('});');
  if (firstField) {
    lines.push('');
    lines.push(
      `it('rejects empty patch body for ${snake}', function (): void {`,
    );
    lines.push('    /** @var Tests\\TestCase $this */');
    lines.push(`    $created = $this->postJson('${url}', [`);
    for (const e of createEntries) lines.push(e);
    lines.push("    ])->json('data');");
    lines.push('');
    lines.push(`    $this->patchJson('${url}/'.$created['id'], [])`);
    lines.push('        ->assertStatus(422);');
    lines.push('});');
  }
  lines.push('');

  return lines.join('\n');
}

function nextMigrationPrefix(existing: string[]): string {
  let maxSeq = 0;
  for (const name of existing) {
    const m = name.match(/^(\d{4})_(\d{2})_(\d{2})_(\d{6})_/);
    if (m) {
      const seq = parseInt(m[4], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  const next = String(maxSeq + 1).padStart(6, '0');
  return `0000_00_00_${next}`;
}

async function appendEloquentEntity(
  cwd: string,
  dir: string,
  config: EntityConfig,
  generated: string[],
): Promise<void> {
  const laravelDir = join(cwd, dir);
  const pascal = toPascal(config.name);

  const modelsDir = join(laravelDir, 'app/Models');
  const modelPath = join(modelsDir, `${pascal}.php`);
  if (!existsSync(modelPath)) {
    await mkdir(modelsDir, { recursive: true });
    await writeFile(modelPath, generateEloquentModel(config));
    generated.push(`${dir}/app/Models/${pascal}.php`);
  }

  const migrationsDir = join(laravelDir, 'database/migrations');
  await mkdir(migrationsDir, { recursive: true });
  const existing = (await readdir(migrationsDir)).filter((f) =>
    f.endsWith('.php'),
  );
  const alreadyHasTable = existing.some((f) =>
    f.endsWith(`_create_${config.tableName}_table.php`),
  );
  if (!alreadyHasTable) {
    const prefix = nextMigrationPrefix(existing);
    const migrationName = `${prefix}_create_${config.tableName}_table.php`;
    await writeFile(
      join(migrationsDir, migrationName),
      generateEloquentMigration(config),
    );
    generated.push(`${dir}/database/migrations/${migrationName}`);
  }

  const providerPath = join(
    laravelDir,
    'app/Providers/EntityServiceProvider.php',
  );
  if (existsSync(providerPath)) {
    const content = await readFile(providerPath, 'utf-8');
    const block = eloquentRegistrationBlock(config);
    if (!content.includes(`baseClass: \\App\\Models\\${pascal}::class,`)) {
      const updated = insertAtAnchor(
        content,
        'projx-anchor: entities',
        '\n' + block,
      );
      if (updated !== content) {
        await writeFile(providerPath, updated);
        generated.push(
          `${dir}/app/Providers/EntityServiceProvider.php (entity registered)`,
        );
      }
    }
  }

  const testsDir = join(laravelDir, 'tests/Feature');
  const testPath = join(testsDir, `${pascal}CrudTest.php`);
  if (existsSync(testsDir) && !existsSync(testPath)) {
    await writeFile(testPath, generateEloquentTest(config));
    generated.push(`${dir}/tests/Feature/${pascal}CrudTest.php`);
  }
}

// --- Rust (SeaORM) generation ---

function rustFieldType(type: FieldType): string {
  switch (type) {
    case 'string':
    case 'text':
      return 'String';
    case 'number':
      return 'i64';
    case 'boolean':
      return 'bool';
    case 'date':
    case 'datetime':
      return 'DateTime<Utc>';
    case 'json':
      return 'Value';
    default:
      return assertNeverFieldType(type);
  }
}

function rustColumnVariant(name: string): string {
  return toPascal(name);
}

function rustSeaOrmAttr(field: EntityField): string | null {
  if (field.unique) return '#[sea_orm(unique)]';
  return null;
}

function rustModelToValueEntry(field: EntityField): string {
  return `        "${field.name}": m.${field.name},`;
}

function rustInsertExtraction(field: EntityField): string[] {
  const name = field.name;
  const lines: string[] = [];
  switch (field.type) {
    case 'string':
    case 'text':
      if (field.required) {
        lines.push(`    let ${name} = payload`);
        lines.push(`        .get("${name}")`);
        lines.push(`        .and_then(|v| v.as_str())`);
        lines.push(
          `        .ok_or_else(|| AppError::Validation("field '${name}' is required".into()))?`,
        );
        lines.push(`        .to_string();`);
        lines.push(`    if ${name}.is_empty() {`);
        lines.push(
          `        return Err(AppError::Validation("field '${name}' is required".into()));`,
        );
        lines.push(`    }`);
      } else {
        lines.push(`    let ${name} = payload`);
        lines.push(`        .get("${name}")`);
        lines.push(`        .and_then(|v| v.as_str())`);
        lines.push(`        .map(|s| s.to_string());`);
      }
      break;
    case 'number':
      if (field.required) {
        lines.push(`    let ${name} = payload`);
        lines.push(`        .get("${name}")`);
        lines.push(`        .and_then(|v| v.as_i64())`);
        lines.push(
          `        .ok_or_else(|| AppError::Validation("field '${name}' is required".into()))?;`,
        );
      } else {
        lines.push(
          `    let ${name} = payload.get("${name}").and_then(|v| v.as_i64());`,
        );
      }
      break;
    case 'boolean':
      if (field.required) {
        lines.push(`    let ${name} = payload`);
        lines.push(`        .get("${name}")`);
        lines.push(`        .and_then(|v| v.as_bool())`);
        lines.push(
          `        .ok_or_else(|| AppError::Validation("field '${name}' is required".into()))?;`,
        );
      } else {
        lines.push(
          `    let ${name} = payload.get("${name}").and_then(|v| v.as_bool());`,
        );
      }
      break;
    case 'date':
    case 'datetime':
      if (field.required) {
        lines.push(`    let ${name} = match payload.get("${name}") {`);
        lines.push(`        Some(v) => v`);
        lines.push(`            .as_str()`);
        lines.push(
          `            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())`,
        );
        lines.push(`            .map(|d| d.with_timezone(&Utc))`);
        lines.push(
          `            .ok_or_else(|| AppError::Validation("field '${name}' must be RFC3339".into()))?,`,
        );
        lines.push(`        None => {`);
        lines.push(
          `            return Err(AppError::Validation("field '${name}' is required".into()));`,
        );
        lines.push(`        }`);
        lines.push(`    };`);
      } else {
        lines.push(`    let ${name} = match payload.get("${name}") {`);
        lines.push(`        Some(v) => Some(`);
        lines.push(`            v.as_str()`);
        lines.push(
          `                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())`,
        );
        lines.push(`                .map(|d| d.with_timezone(&Utc))`);
        lines.push(
          `                .ok_or_else(|| AppError::Validation("field '${name}' must be RFC3339".into()))?,`,
        );
        lines.push(`        ),`);
        lines.push(`        None => None,`);
        lines.push(`    };`);
      }
      break;
    case 'json':
      if (field.required) {
        lines.push(
          `    let ${name} = payload.get("${name}").cloned().unwrap_or(Value::Null);`,
        );
      } else {
        lines.push(`    let ${name} = payload.get("${name}").cloned();`);
      }
      break;
    default:
      return assertNeverFieldType(field.type);
  }
  return lines;
}

function rustUpdateApplication(field: EntityField): string[] {
  const name = field.name;
  const lines: string[] = [];
  lines.push(`        if let Some(v) = patch.get("${name}") {`);
  switch (field.type) {
    case 'string':
    case 'text':
      if (field.required) {
        lines.push(`            if let Some(s) = v.as_str() {`);
        lines.push(`                if s.is_empty() {`);
        lines.push(
          `                    return Err(AppError::Validation("field '${name}' is required".into()));`,
        );
        lines.push(`                }`);
        lines.push(`                am.${name} = Set(s.to_string());`);
        lines.push(`            }`);
      } else {
        lines.push(
          `            am.${name} = Set(v.as_str().map(|s| s.to_string()));`,
        );
      }
      break;
    case 'number':
      if (field.required) {
        lines.push(`            if let Some(n) = v.as_i64() {`);
        lines.push(`                am.${name} = Set(n);`);
        lines.push(`            }`);
      } else {
        lines.push(`            am.${name} = Set(v.as_i64());`);
      }
      break;
    case 'boolean':
      if (field.required) {
        lines.push(`            if let Some(b) = v.as_bool() {`);
        lines.push(`                am.${name} = Set(b);`);
        lines.push(`            }`);
      } else {
        lines.push(`            am.${name} = Set(v.as_bool());`);
      }
      break;
    case 'date':
    case 'datetime':
      if (field.required) {
        lines.push(`            if let Some(s) = v.as_str() {`);
        lines.push(
          `                if let Ok(parsed) = DateTime::parse_from_rfc3339(s) {`,
        );
        lines.push(
          `                    am.${name} = Set(parsed.with_timezone(&Utc));`,
        );
        lines.push(`                }`);
        lines.push(`            }`);
      } else {
        lines.push(
          `            am.${name} = Set(v.as_str().and_then(|s| DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&Utc)));`,
        );
      }
      break;
    case 'json':
      if (field.required) {
        lines.push(`            am.${name} = Set(v.clone());`);
      } else {
        lines.push(`            am.${name} = Set(Some(v.clone()));`);
      }
      break;
    default:
      return assertNeverFieldType(field.type);
  }
  lines.push(`        }`);
  return lines;
}

function rustSampleField(field: EntityField): string {
  switch (field.type) {
    case 'string':
    case 'text':
      return `"sample"`;
    case 'number':
      return '1';
    case 'boolean':
      return 'true';
    case 'date':
      return `"2026-01-01T00:00:00Z"`;
    case 'datetime':
      return `"2026-01-01T00:00:00Z"`;
    case 'json':
      return '{}';
    default:
      return assertNeverFieldType(field.type);
  }
}

function rustActiveModelInit(field: EntityField): string {
  return `        ${field.name}: Set(${field.name}),`;
}

function generateRustEntity(config: EntityConfig): string {
  const pascal = toPascal(config.name);
  const handler = `${pascal}Handler`;
  const snake = toSnake(config.name);

  const allColumns = [
    'id',
    ...config.fields.map((f) => f.name),
    'created_at',
    'updated_at',
    'deleted_at',
  ];
  const updatableColumns = config.fields
    .filter((f) => !f.generated)
    .map((f) => f.name);

  const lines: string[] = [];

  lines.push('use std::sync::Arc;');
  lines.push('');
  lines.push('use async_trait::async_trait;');
  lines.push('use chrono::{DateTime, Utc};');
  lines.push('use sea_orm::entity::prelude::*;');
  lines.push(
    'use sea_orm::sea_query::{Alias, Condition, Expr, IntoCondition, Order};',
  );
  lines.push('use sea_orm::{');
  lines.push(
    '    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder,',
  );
  lines.push('    QuerySelect, Set, TransactionTrait,');
  lines.push('};');
  lines.push('use serde::{Deserialize, Serialize};');
  lines.push('use serde_json::{json, Value};');
  lines.push('use uuid::Uuid;');
  lines.push('');
  lines.push('use crate::apperr::from_db;');
  lines.push('use crate::entities::query::{ListParams, PageResult};');
  lines.push(
    'use crate::entities::types::{EntityConfig, EntityHandler, Hooks};',
  );
  lines.push('use crate::error::AppError;');
  lines.push('');
  lines.push(
    '#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]',
  );
  lines.push(`#[sea_orm(table_name = "${config.tableName}")]`);
  lines.push('pub struct Model {');
  lines.push(
    '    #[sea_orm(primary_key, auto_increment = false, column_type = "Uuid")]',
  );
  lines.push('    pub id: Uuid,');
  for (const f of config.fields) {
    const attr = rustSeaOrmAttr(f);
    if (attr) lines.push(`    ${attr}`);
    const rustType = rustFieldType(f.type);
    const ty = f.required ? rustType : `Option<${rustType}>`;
    lines.push(`    pub ${f.name}: ${ty},`);
  }
  lines.push('    pub created_at: DateTime<Utc>,');
  lines.push('    pub updated_at: DateTime<Utc>,');
  lines.push('    pub deleted_at: Option<DateTime<Utc>>,');
  lines.push('}');
  lines.push('');
  lines.push('#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]');
  lines.push('pub enum Relation {}');
  lines.push('');
  lines.push('impl ActiveModelBehavior for ActiveModel {}');
  lines.push('');
  lines.push('const ALL_COLUMNS: &[&str] = &[');
  for (const c of allColumns) {
    lines.push(`    "${c}",`);
  }
  lines.push('];');
  lines.push('');
  const updArr = updatableColumns.map((c) => `"${c}"`).join(', ');
  lines.push(`const UPDATABLE_COLUMNS: &[&str] = &[${updArr}];`);
  lines.push('');
  const searchArr = config.searchableFields.map((f) => `"${f}"`).join(', ');
  lines.push(`const SEARCHABLE: &[&str] = &[${searchArr}];`);
  lines.push('');
  lines.push(`pub struct ${handler};`);
  lines.push('');
  lines.push('fn model_to_value(m: &Model) -> Value {');
  lines.push('    json!({');
  lines.push('        "id": m.id.to_string(),');
  for (const f of config.fields) {
    lines.push(rustModelToValueEntry(f));
  }
  lines.push('        "created_at": m.created_at,');
  lines.push('        "updated_at": m.updated_at,');
  lines.push('        "deleted_at": m.deleted_at,');
  lines.push('    })');
  lines.push('}');
  lines.push('');
  lines.push('fn parse_uuid(id: &str) -> Result<Uuid, AppError> {');
  lines.push(
    '    Uuid::parse_str(id).map_err(|_| AppError::Validation("invalid id".into()))',
  );
  lines.push('}');
  lines.push('');
  lines.push('fn col_from_str(name: &str) -> Option<Column> {');
  lines.push('    match name {');
  lines.push('        "id" => Some(Column::Id),');
  for (const f of config.fields) {
    lines.push(
      `        "${f.name}" => Some(Column::${rustColumnVariant(f.name)}),`,
    );
  }
  lines.push('        "created_at" => Some(Column::CreatedAt),');
  lines.push('        "updated_at" => Some(Column::UpdatedAt),');
  lines.push('        "deleted_at" => Some(Column::DeletedAt),');
  lines.push('        _ => None,');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push('#[async_trait]');
  lines.push(`impl EntityHandler for ${handler} {`);
  lines.push("    fn all_columns(&self) -> &'static [&'static str] {");
  lines.push('        ALL_COLUMNS');
  lines.push('    }');
  lines.push("    fn updatable_columns(&self) -> &'static [&'static str] {");
  lines.push('        UPDATABLE_COLUMNS');
  lines.push('    }');
  lines.push('');
  lines.push('    async fn list(');
  lines.push('        &self,');
  lines.push('        db: &DatabaseConnection,');
  lines.push('        params: &ListParams,');
  lines.push('        cfg: &EntityConfig,');
  lines.push('    ) -> Result<PageResult, AppError> {');
  lines.push('        let mut q = Entity::find();');
  lines.push('        if cfg.soft_delete && !params.include_deleted {');
  lines.push('            q = q.filter(Column::DeletedAt.is_null());');
  lines.push('        }');
  lines.push('');
  lines.push('        for (k, v) in &params.filters {');
  lines.push('            if let Some(col) = col_from_str(k) {');
  lines.push('                q = q.filter(col.eq(v.clone()));');
  lines.push('            }');
  lines.push('        }');
  lines.push('');
  lines.push('        if let Some(needle) = &params.search {');
  lines.push('            if !cfg.searchable_fields.is_empty() {');
  lines.push('                let pattern = format!("%{}%", needle);');
  lines.push('                let mut cond = Condition::any();');
  lines.push('                for f in &cfg.searchable_fields {');
  lines.push('                    if let Some(col) = col_from_str(f) {');
  lines.push('                        cond = cond.add(');
  lines.push('                            Expr::col(col)');
  lines.push('                                .cast_as(Alias::new("text"))');
  lines.push('                                .like(pattern.clone()),');
  lines.push('                        );');
  lines.push('                    }');
  lines.push('                }');
  lines.push('                q = q.filter(cond.into_condition());');
  lines.push('            }');
  lines.push('        }');
  lines.push('');
  lines.push('        for raw in &params.order_by {');
  lines.push(
    "            let (desc, key) = if let Some(rest) = raw.strip_prefix('-') {",
  );
  lines.push('                (true, rest)');
  lines.push('            } else {');
  lines.push('                (false, raw.as_str())');
  lines.push('            };');
  lines.push('            if let Some(col) = col_from_str(key) {');
  lines.push('                q = if desc {');
  lines.push('                    q.order_by(col, Order::Desc)');
  lines.push('                } else {');
  lines.push('                    q.order_by(col, Order::Asc)');
  lines.push('                };');
  lines.push('            }');
  lines.push('        }');
  lines.push('');
  lines.push('        let total = q');
  lines.push('            .clone()');
  lines.push('            .count(db)');
  lines.push('            .await');
  lines.push('            .map_err(|e| from_db(e, cfg.name))?;');
  lines.push('        let rows = q');
  lines.push('            .limit(params.page_size)');
  lines.push('            .offset(params.offset())');
  lines.push('            .all(db)');
  lines.push('            .await');
  lines.push('            .map_err(|e| from_db(e, cfg.name))?;');
  lines.push('');
  lines.push(
    '        let data = Value::Array(rows.iter().map(model_to_value).collect());',
  );
  lines.push('        Ok(PageResult {');
  lines.push('            data,');
  lines.push('            pagination: params.pagination(total),');
  lines.push('        })');
  lines.push('    }');
  lines.push('');
  lines.push('    async fn get_by_id(');
  lines.push('        &self,');
  lines.push('        db: &DatabaseConnection,');
  lines.push('        id: &str,');
  lines.push('        cfg: &EntityConfig,');
  lines.push('    ) -> Result<Value, AppError> {');
  lines.push('        let uid = parse_uuid(id)?;');
  lines.push('        let mut q = Entity::find_by_id(uid);');
  lines.push('        if cfg.soft_delete {');
  lines.push('            q = q.filter(Column::DeletedAt.is_null());');
  lines.push('        }');
  lines.push('        let row = q');
  lines.push('            .one(db)');
  lines.push('            .await');
  lines.push('            .map_err(|e| from_db(e, cfg.name))?');
  lines.push(
    '            .ok_or_else(|| AppError::NotFound(cfg.name.to_string()))?;',
  );
  lines.push('        Ok(model_to_value(&row))');
  lines.push('    }');
  lines.push('');
  lines.push('    async fn create(');
  lines.push('        &self,');
  lines.push('        db: &DatabaseConnection,');
  lines.push('        payload: Value,');
  lines.push('        cfg: &EntityConfig,');
  lines.push('    ) -> Result<Value, AppError> {');
  lines.push('        insert_one(db, payload, cfg.name).await');
  lines.push('    }');
  lines.push('');
  lines.push('    async fn update(');
  lines.push('        &self,');
  lines.push('        db: &DatabaseConnection,');
  lines.push('        id: &str,');
  lines.push('        patch: Value,');
  lines.push('        cfg: &EntityConfig,');
  lines.push('    ) -> Result<(Value, Value), AppError> {');
  lines.push('        let uid = parse_uuid(id)?;');
  lines.push('        let mut q = Entity::find_by_id(uid);');
  lines.push('        if cfg.soft_delete {');
  lines.push('            q = q.filter(Column::DeletedAt.is_null());');
  lines.push('        }');
  lines.push('        let existing = q');
  lines.push('            .one(db)');
  lines.push('            .await');
  lines.push('            .map_err(|e| from_db(e, cfg.name))?');
  lines.push(
    '            .ok_or_else(|| AppError::NotFound(cfg.name.to_string()))?;',
  );
  lines.push('        let before = model_to_value(&existing);');
  lines.push('');
  lines.push('        let mut am: ActiveModel = existing.into();');
  for (const f of config.fields.filter((field) => !field.generated)) {
    for (const l of rustUpdateApplication(f)) lines.push(l);
  }
  lines.push('        am.updated_at = Set(Utc::now());');
  lines.push(
    '        let updated = am.update(db).await.map_err(|e| from_db(e, cfg.name))?;',
  );
  lines.push('        Ok((before, model_to_value(&updated)))');
  lines.push('    }');
  lines.push('');
  lines.push('    async fn soft_delete(');
  lines.push('        &self,');
  lines.push('        db: &DatabaseConnection,');
  lines.push('        id: &str,');
  lines.push('        cfg: &EntityConfig,');
  lines.push('    ) -> Result<u64, AppError> {');
  lines.push('        let uid = parse_uuid(id)?;');
  lines.push('        let existing = Entity::find_by_id(uid)');
  lines.push('            .filter(Column::DeletedAt.is_null())');
  lines.push('            .one(db)');
  lines.push('            .await');
  lines.push('            .map_err(|e| from_db(e, cfg.name))?;');
  lines.push('        let Some(model) = existing else {');
  lines.push('            return Ok(0);');
  lines.push('        };');
  lines.push('        let mut am: ActiveModel = model.into();');
  lines.push('        am.deleted_at = Set(Some(Utc::now()));');
  lines.push('        am.updated_at = Set(Utc::now());');
  lines.push('        am.update(db).await.map_err(|e| from_db(e, cfg.name))?;');
  lines.push('        Ok(1)');
  lines.push('    }');
  lines.push('');
  lines.push('    async fn hard_delete(');
  lines.push('        &self,');
  lines.push('        db: &DatabaseConnection,');
  lines.push('        id: &str,');
  lines.push('        cfg: &EntityConfig,');
  lines.push('    ) -> Result<u64, AppError> {');
  lines.push('        let uid = parse_uuid(id)?;');
  lines.push('        let res = Entity::delete_by_id(uid)');
  lines.push('            .exec(db)');
  lines.push('            .await');
  lines.push('            .map_err(|e| from_db(e, cfg.name))?;');
  lines.push('        Ok(res.rows_affected)');
  lines.push('    }');
  lines.push('');
  lines.push('    async fn bulk_create(');
  lines.push('        &self,');
  lines.push('        db: &DatabaseConnection,');
  lines.push('        payloads: Vec<Value>,');
  lines.push('        cfg: &EntityConfig,');
  lines.push('    ) -> Result<Vec<Value>, AppError> {');
  lines.push(
    '        let txn = db.begin().await.map_err(|e| from_db(e, cfg.name))?;',
  );
  lines.push('        let mut out = Vec::with_capacity(payloads.len());');
  lines.push('        for payload in payloads {');
  lines.push('            match insert_one(&txn, payload, cfg.name).await {');
  lines.push('                Ok(v) => out.push(v),');
  lines.push('                Err(e) => {');
  lines.push('                    let _ = txn.rollback().await;');
  lines.push('                    return Err(e);');
  lines.push('                }');
  lines.push('            }');
  lines.push('        }');
  lines.push('        txn.commit().await.map_err(|e| from_db(e, cfg.name))?;');
  lines.push('        Ok(out)');
  lines.push('    }');
  lines.push('');
  lines.push('    async fn bulk_delete(');
  lines.push('        &self,');
  lines.push('        db: &DatabaseConnection,');
  lines.push('        ids: &[String],');
  lines.push('        cfg: &EntityConfig,');
  lines.push('    ) -> Result<u64, AppError> {');
  lines.push('        let mut uuids = Vec::with_capacity(ids.len());');
  lines.push('        for id in ids {');
  lines.push('            uuids.push(parse_uuid(id)?);');
  lines.push('        }');
  lines.push('        if cfg.soft_delete {');
  lines.push('            let now = Utc::now();');
  lines.push('            let res = Entity::update_many()');
  lines.push(
    '                .col_expr(Column::DeletedAt, Expr::value(Some(now)))',
  );
  lines.push('                .col_expr(Column::UpdatedAt, Expr::value(now))');
  lines.push('                .filter(Column::Id.is_in(uuids))');
  lines.push('                .filter(Column::DeletedAt.is_null())');
  lines.push('                .exec(db)');
  lines.push('                .await');
  lines.push('                .map_err(|e| from_db(e, cfg.name))?;');
  lines.push('            Ok(res.rows_affected)');
  lines.push('        } else {');
  lines.push('            let res = Entity::delete_many()');
  lines.push('                .filter(Column::Id.is_in(uuids))');
  lines.push('                .exec(db)');
  lines.push('                .await');
  lines.push('                .map_err(|e| from_db(e, cfg.name))?;');
  lines.push('            Ok(res.rows_affected)');
  lines.push('        }');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push('async fn insert_one<C: sea_orm::ConnectionTrait>(');
  lines.push('    conn: &C,');
  lines.push('    payload: Value,');
  lines.push('    name: &str,');
  lines.push(') -> Result<Value, AppError> {');
  for (const f of config.fields) {
    for (const l of rustInsertExtraction(f)) lines.push(l);
  }
  lines.push('    let now = Utc::now();');
  lines.push('    let am = ActiveModel {');
  lines.push('        id: Set(Uuid::new_v4()),');
  for (const f of config.fields) {
    lines.push(rustActiveModelInit(f));
  }
  lines.push('        created_at: Set(now),');
  lines.push('        updated_at: Set(now),');
  lines.push('        deleted_at: Set(None),');
  lines.push('    };');
  lines.push(
    '    let inserted = am.insert(conn).await.map_err(|e| from_db(e, name))?;',
  );
  lines.push('    Ok(model_to_value(&inserted))');
  lines.push('}');
  lines.push('');
  lines.push('pub fn config() -> EntityConfig {');
  lines.push('    EntityConfig {');
  lines.push(`        name: "${snake}",`);
  lines.push(`        base_path: "${config.apiPrefix}",`);
  lines.push(`        handler: Arc::new(${handler}),`);
  lines.push('        searchable_fields: SEARCHABLE.to_vec(),');
  lines.push('        hidden_fields: vec!["deleted_at"],');
  lines.push(`        soft_delete: ${String(config.softDelete)},`);
  lines.push('        hooks: Hooks::default(),');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push(...generateRustEntityTests(config));
  lines.push('');

  return lines.join('\n');
}

function generateRustEntityTests(config: EntityConfig): string[] {
  const pascal = toPascal(config.name);
  const handler = `${pascal}Handler`;
  const snake = toSnake(config.name);
  const requiredString = config.fields.find(
    (f) => (f.type === 'string' || f.type === 'text') && f.required,
  );
  const sampleEntries = config.fields
    .filter((f) => f.required)
    .map((f) => `"${f.name}": ${rustSampleField(f)}`)
    .join(', ');

  const lines: string[] = [];
  lines.push('#[cfg(test)]');
  lines.push('mod tests {');
  lines.push('    use super::*;');
  lines.push(
    '    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};',
  );
  lines.push('');
  lines.push('    fn mock_db() -> DatabaseConnection {');
  lines.push(
    '        MockDatabase::new(DatabaseBackend::Postgres).into_connection()',
  );
  lines.push('    }');
  lines.push('');
  lines.push('    #[test]');
  lines.push('    fn config_is_well_formed() {');
  lines.push('        let c = config();');
  lines.push(`        assert_eq!(c.name, "${snake}");`);
  lines.push(`        assert_eq!(c.base_path, "${config.apiPrefix}");`);
  lines.push(
    `        assert_eq!(c.soft_delete, ${String(config.softDelete)});`,
  );
  lines.push('        assert!(c.validate().is_ok());');
  lines.push('    }');
  lines.push('');
  lines.push('    #[test]');
  lines.push('    fn parse_uuid_rejects_garbage() {');
  lines.push('        assert!(parse_uuid("not-a-uuid").is_err());');
  lines.push(
    '        assert!(parse_uuid(&Uuid::new_v4().to_string()).is_ok());',
  );
  lines.push('    }');
  lines.push('');
  lines.push('    #[test]');
  lines.push('    fn col_from_str_known_and_unknown() {');
  lines.push('        assert!(col_from_str("id").is_some());');
  lines.push('        assert!(col_from_str("doesnotexist").is_none());');
  lines.push('    }');
  if (requiredString) {
    lines.push('');
    lines.push('    #[tokio::test]');
    lines.push(
      `    async fn insert_one_rejects_empty_${requiredString.name}() {`,
    );
    lines.push('        let db = mock_db();');
    lines.push(
      `        let err = insert_one(&db, json!({"${requiredString.name}": ""}), "${snake}")`,
    );
    lines.push('            .await');
    lines.push('            .unwrap_err();');
    lines.push('        assert!(matches!(err, AppError::Validation(_)));');
    lines.push('    }');
  }
  lines.push('');
  lines.push('    #[tokio::test]');
  lines.push('    async fn handler_hard_delete_returns_rows_affected() {');
  lines.push('        let db = MockDatabase::new(DatabaseBackend::Postgres)');
  lines.push('            .append_exec_results([MockExecResult {');
  lines.push('                last_insert_id: 0,');
  lines.push('                rows_affected: 1,');
  lines.push('            }])');
  lines.push('            .into_connection();');
  lines.push('        let cfg = config();');
  lines.push('        let id = Uuid::new_v4().to_string();');
  lines.push(
    `        let n = ${handler}.hard_delete(&db, &id, &cfg).await.unwrap();`,
  );
  lines.push('        assert_eq!(n, 1);');
  lines.push('    }');
  lines.push('');
  lines.push('    #[tokio::test]');
  lines.push('    async fn handler_get_by_id_404_when_missing() {');
  lines.push('        let empty: Vec<Model> = vec![];');
  lines.push('        let db = MockDatabase::new(DatabaseBackend::Postgres)');
  lines.push('            .append_query_results([empty])');
  lines.push('            .into_connection();');
  lines.push('        let cfg = config();');
  lines.push(`        let err = ${handler}`);
  lines.push('            .get_by_id(&db, &Uuid::new_v4().to_string(), &cfg)');
  lines.push('            .await');
  lines.push('            .unwrap_err();');
  lines.push('        assert!(matches!(err, AppError::NotFound(_)));');
  lines.push('    }');
  if (sampleEntries.length > 0 && requiredString) {
    lines.push('');
    lines.push('    #[tokio::test]');
    lines.push('    async fn handler_create_maps_db_conflict() {');
    lines.push('        let db = MockDatabase::new(DatabaseBackend::Postgres)');
    lines.push('            .append_query_errors([sea_orm::DbErr::Custom(');
    lines.push(
      '                "duplicate key value violates unique constraint code: \\"23505\\"".into(),',
    );
    lines.push('            )])');
    lines.push('            .into_connection();');
    lines.push('        let cfg = config();');
    lines.push(`        let err = ${handler}`);
    lines.push(`            .create(&db, json!({${sampleEntries}}), &cfg)`);
    lines.push('            .await');
    lines.push('            .unwrap_err();');
    lines.push('        assert!(matches!(err, AppError::Conflict(_)));');
    lines.push('    }');
  }
  lines.push('}');
  return lines;
}

async function readCargoCrateName(rustDir: string): Promise<string> {
  const path = join(rustDir, 'Cargo.toml');
  if (!existsSync(path)) {
    throw new Error(`Cargo.toml not found at ${path}`);
  }
  const content = await readFile(path, 'utf-8');
  const libMatch = content.match(/\[lib\][\s\S]*?name\s*=\s*"([^"]+)"/);
  if (libMatch) return libMatch[1];
  const pkgMatch = content.match(/\[package\][\s\S]*?name\s*=\s*"([^"]+)"/);
  if (pkgMatch) return pkgMatch[1];
  throw new Error(`Could not parse crate name from ${path}`);
}

function insertLibModule(content: string, modLine: string): string {
  if (content.includes(modLine)) return content;
  const lines = content.split('\n');
  const modIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^pub mod\s+\w+;/.test(lines[i])) modIndices.push(i);
  }
  if (modIndices.length === 0) {
    return modLine + '\n' + content;
  }
  let insertAt = modIndices[modIndices.length - 1] + 1;
  for (const idx of modIndices) {
    if (lines[idx] > modLine) {
      insertAt = idx;
      break;
    }
  }
  lines.splice(insertAt, 0, modLine);
  return lines.join('\n');
}

async function appendSeaormEntity(
  cwd: string,
  dir: string,
  config: EntityConfig,
  generated: string[],
): Promise<void> {
  const rustDir = join(cwd, dir);
  const crate = await readCargoCrateName(rustDir);
  const snake = toSnake(config.name);

  const entityDir = join(rustDir, 'src', snake);
  const modPath = join(entityDir, 'mod.rs');
  if (!existsSync(modPath)) {
    await mkdir(entityDir, { recursive: true });
    await writeFile(modPath, generateRustEntity(config));
    generated.push(`${dir}/src/${snake}/mod.rs`);
  }

  const libPath = join(rustDir, 'src/lib.rs');
  if (existsSync(libPath)) {
    const content = await readFile(libPath, 'utf-8');
    const modLine = `pub mod ${snake};`;
    const updated = insertLibModule(content, modLine);
    if (updated !== content) {
      await writeFile(libPath, updated);
      generated.push(`${dir}/src/lib.rs (module registered)`);
    }
  }

  const mainPath = join(rustDir, 'src/main.rs');
  if (existsSync(mainPath)) {
    let mainContent = await readFile(mainPath, 'utf-8');
    const importLine = `use ${crate}::${snake};`;
    const registrationLine = `    ${crate}::entities::register(${snake}::config());`;
    const updated = insertAtAnchor(
      insertAtAnchor(mainContent, 'projx-anchor: entity-imports', importLine),
      'projx-anchor: entity-registrations',
      registrationLine,
    );
    if (updated !== mainContent) {
      mainContent = updated;
      await writeFile(mainPath, mainContent);
      generated.push(`${dir}/src/main.rs (entity wired)`);
    }
  }
}

// --- Main ---

type BackendTarget = (typeof BACKEND_COMPONENTS)[number];

async function resolvePrimaryBackend(
  cwd: string,
  hasFastapi: boolean,
  hasFastify: boolean,
  hasExpress: boolean,
  backendFlag?: BackendTarget,
): Promise<BackendTarget> {
  if (backendFlag) return backendFlag;
  const backends = [
    hasFastapi ? 'fastapi' : undefined,
    hasFastify ? 'fastify' : undefined,
    hasExpress ? 'express' : undefined,
  ].filter((item): item is BackendTarget => item !== undefined);
  if (backends.length === 1) return backends[0];

  const config = await readProjxConfig(cwd);
  if (
    typeof config.primaryBackend === 'string' &&
    (BACKEND_COMPONENTS as readonly string[]).includes(config.primaryBackend)
  ) {
    return config.primaryBackend as BackendTarget;
  }

  if (!process.stdin.isTTY) {
    return hasFastify ? 'fastify' : hasExpress ? 'express' : 'fastapi';
  }

  const choice = (await p.select({
    message: 'Multiple backends detected. Which is your primary?',
    options: [
      ...(hasFastify
        ? [{ value: 'fastify', label: 'fastify (API backend)' }]
        : []),
      ...(hasExpress
        ? [{ value: 'express', label: 'express (API backend)' }]
        : []),
      ...(hasFastapi
        ? [{ value: 'fastapi', label: 'fastapi (AI/ML engine)' }]
        : []),
    ],
    initialValue: (hasFastify
      ? 'fastify'
      : hasExpress
        ? 'express'
        : 'fastapi') as BackendTarget,
  })) as BackendTarget | symbol;

  if (p.isCancel(choice)) process.exit(0);

  await writeProjxConfig(cwd, { ...config, primaryBackend: choice });
  p.log.success(`Saved primaryBackend: ${choice} to .projx`);

  return choice as BackendTarget;
}

export async function gen(
  cwd: string,
  entityName: string,
  fieldsFlag?: string,
  backendFlag?: BackendTarget,
  localRepo?: string,
): Promise<void> {
  p.intro(`projx gen entity ${entityName}`);

  if (!existsSync(join(cwd, '.projx'))) {
    p.log.error("No .projx file found. Run 'npx create-projx init' first.");
    process.exit(1);
  }

  const projxData = await readProjxConfig(cwd);
  const pmName: PackageManager =
    (projxData.packageManager as PackageManager) ?? 'npm';
  const pm = pmCommands(pmName);
  const orm = (projxData.orm as string | undefined) ?? 'prisma';
  const needsAddon =
    orm === 'drizzle' ||
    orm === 'sequelize' ||
    orm === 'typeorm' ||
    orm === 'sqlc' ||
    orm === 'ent';
  const repoDir = needsAddon
    ? await downloadRepo(localRepo).catch((err) => {
        p.cancel(`Failed to fetch templates: ${(err as Error).message}`);
        process.exit(1);
      })
    : '';
  const isLocal = Boolean(localRepo);

  try {
    return await runGen({
      cwd,
      entityName,
      fieldsFlag,
      backendFlag,
      pm,
      orm,
      repoDir,
    });
  } finally {
    if (needsAddon && repoDir) {
      await cleanupRepo(repoDir, isLocal);
    }
  }
}

interface RunGenOpts {
  cwd: string;
  entityName: string;
  fieldsFlag?: string;
  backendFlag?: BackendTarget;
  pm: ReturnType<typeof pmCommands>;
  orm: string;
  repoDir: string;
}

async function runGen(opts: RunGenOpts): Promise<void> {
  const { cwd, entityName, fieldsFlag, backendFlag, pm, orm, repoDir } = opts;

  const { components: discovered, paths: componentPaths } =
    await discoverComponentsFromMarkers(cwd);

  const hasFastapi = discovered.includes('fastapi');
  const hasFastify = discovered.includes('fastify');
  const hasExpress = discovered.includes('express');
  const hasGo = discovered.includes('go');
  const hasRust = discovered.includes('rust');
  const hasLaravel = discovered.includes('laravel');
  const hasVitejs = discovered.includes('vitejs');
  const hasNextjs = discovered.includes('nextjs');
  const hasMobile = discovered.includes('mobile');

  if (
    !hasFastapi &&
    !hasFastify &&
    !hasExpress &&
    !hasGo &&
    !hasRust &&
    !hasLaravel
  ) {
    p.log.error(
      `No backend component found. Need ${BACKEND_COMPONENTS.join(', ')}.`,
    );
    process.exit(1);
  }

  const targetBackend = await resolvePrimaryBackend(
    cwd,
    hasFastapi,
    hasFastify,
    hasExpress,
    backendFlag,
  );
  const genFastapi = targetBackend === 'fastapi' && hasFastapi;
  const genFastify = targetBackend === 'fastify' && hasFastify;
  const genExpress = targetBackend === 'express' && hasExpress;
  const genDrizzle = orm === 'drizzle' && (genFastify || genExpress);
  const genSequelize = orm === 'sequelize' && (genFastify || genExpress);
  const genTypeorm = orm === 'typeorm' && (genFastify || genExpress);

  let config: EntityConfig;

  if (fieldsFlag) {
    const fields = parseFieldsFlag(fieldsFlag);
    const snake = toSnake(entityName);
    const tableName = pluralize(snake);
    const kebab = toKebab(entityName);

    config = {
      name: entityName,
      tableName,
      apiPrefix: '/' + pluralize(kebab),
      readonly: false,
      softDelete: false,
      bulkOperations: true,
      fields,
      searchableFields: fields
        .filter((f) => f.type === 'string' || f.type === 'text')
        .map((f) => f.name),
    };
  } else {
    config = await promptEntityConfig(entityName);
  }

  const generated: string[] = [];

  if (genFastapi) {
    const dir = componentPaths.fastapi;
    const entityDir = join(cwd, dir, 'src/entities', toSnake(config.name));

    if (existsSync(entityDir)) {
      p.log.warn(
        `${dir}/src/entities/${toSnake(config.name)}/ already exists. Skipping FastAPI.`,
      );
    } else {
      await mkdir(entityDir, { recursive: true });
      await writeFile(
        join(entityDir, '_model.py'),
        generateFastAPIModel(config),
      );
      await writeFile(
        join(entityDir, '__init__.py'),
        'from ._model import *\n',
      );
      generated.push(`${dir}/src/entities/${toSnake(config.name)}/_model.py`);
      generated.push(`${dir}/src/entities/${toSnake(config.name)}/__init__.py`);

      const testsDir = join(cwd, dir, 'tests');
      const testFile = join(testsDir, `test_${toSnake(config.name)}_entity.py`);
      if (existsSync(testsDir) && !existsSync(testFile)) {
        await writeFile(testFile, generateFastapiTest(config));
        generated.push(`${dir}/tests/test_${toSnake(config.name)}_entity.py`);
      }
    }
  }

  if (
    genFastify &&
    orm !== 'drizzle' &&
    orm !== 'sequelize' &&
    orm !== 'typeorm'
  ) {
    const dir = componentPaths.fastify;
    const moduleDir = join(cwd, dir, 'src/modules', toKebab(config.name));

    if (existsSync(moduleDir)) {
      p.log.warn(
        `${dir}/src/modules/${toKebab(config.name)}/ already exists. Skipping Fastify.`,
      );
    } else {
      await mkdir(moduleDir, { recursive: true });
      await writeFile(
        join(moduleDir, 'schemas.ts'),
        generateFastifySchemas(config),
      );
      await writeFile(
        join(moduleDir, 'index.ts'),
        generateFastifyIndex(config),
      );
      generated.push(`${dir}/src/modules/${toKebab(config.name)}/schemas.ts`);
      generated.push(`${dir}/src/modules/${toKebab(config.name)}/index.ts`);

      // Add import to app.ts
      const appPath = join(cwd, dir, 'src/app.ts');
      if (existsSync(appPath)) {
        const appContent = await readFile(appPath, 'utf-8');
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
      const prismaPath = join(cwd, dir, 'prisma/schema.prisma');
      if (existsSync(prismaPath)) {
        const prismaContent = await readFile(prismaPath, 'utf-8');
        const modelName = `model ${toPascal(config.name)}`;
        if (!prismaContent.includes(modelName)) {
          const prismaModel = generatePrismaModel(config);
          await writeFile(
            prismaPath,
            prismaContent.trimEnd() + '\n\n' + prismaModel + '\n',
          );
          generated.push(`${dir}/prisma/schema.prisma (model added)`);
        }
      }

      const testsModulesDir = join(cwd, dir, 'tests/modules');
      const fastifyTestFile = join(
        testsModulesDir,
        `${toKebab(config.name)}.test.ts`,
      );
      if (existsSync(testsModulesDir) && !existsSync(fastifyTestFile)) {
        await writeFile(fastifyTestFile, generateFastifyTest(config));
        generated.push(`${dir}/tests/modules/${toKebab(config.name)}.test.ts`);
      }
    }
  }

  if (genFastify && orm === 'drizzle') {
    await appendDrizzleEntity(
      repoDir,
      cwd,
      componentPaths.fastify,
      'fastify',
      config,
      generated,
    );
  } else if (genFastify && orm === 'sequelize') {
    await appendSequelizeEntity(
      repoDir,
      cwd,
      componentPaths.fastify,
      'fastify',
      config,
      generated,
    );
  } else if (genFastify && orm === 'typeorm') {
    await appendTypeormEntity(
      repoDir,
      cwd,
      componentPaths.fastify,
      'fastify',
      config,
      generated,
    );
  }

  if (
    genExpress &&
    orm !== 'drizzle' &&
    orm !== 'sequelize' &&
    orm !== 'typeorm'
  ) {
    const dir = componentPaths.express;
    const moduleDir = join(cwd, dir, 'src/modules', toKebab(config.name));

    if (existsSync(moduleDir)) {
      p.log.warn(
        `${dir}/src/modules/${toKebab(config.name)}/ already exists. Skipping Express.`,
      );
    } else {
      await mkdir(moduleDir, { recursive: true });
      await writeFile(
        join(moduleDir, 'schemas.ts'),
        generateExpressSchemas(config),
      );
      await writeFile(
        join(moduleDir, 'index.ts'),
        generateExpressIndex(config),
      );
      generated.push(`${dir}/src/modules/${toKebab(config.name)}/schemas.ts`);
      generated.push(`${dir}/src/modules/${toKebab(config.name)}/index.ts`);

      const appPath = join(cwd, dir, 'src/app.ts');
      if (existsSync(appPath)) {
        const appContent = await readFile(appPath, 'utf-8');
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

      const prismaPath = join(cwd, dir, 'prisma/schema.prisma');
      if (existsSync(prismaPath)) {
        const prismaContent = await readFile(prismaPath, 'utf-8');
        const modelName = `model ${toPascal(config.name)}`;
        if (!prismaContent.includes(modelName)) {
          const prismaModel = generatePrismaModel(config);
          await writeFile(
            prismaPath,
            prismaContent.trimEnd() + '\n\n' + prismaModel + '\n',
          );
          generated.push(`${dir}/prisma/schema.prisma (model added)`);
        }
      }

      const testsModulesDir = join(cwd, dir, 'tests/modules');
      const expressTestFile = join(
        testsModulesDir,
        `${toKebab(config.name)}.test.ts`,
      );
      if (existsSync(testsModulesDir) && !existsSync(expressTestFile)) {
        await writeFile(expressTestFile, generateExpressTest(config));
        generated.push(`${dir}/tests/modules/${toKebab(config.name)}.test.ts`);
      }
    }
  }

  if (genExpress && orm === 'drizzle') {
    await appendDrizzleEntity(
      repoDir,
      cwd,
      componentPaths.express,
      'express',
      config,
      generated,
    );
  } else if (genExpress && orm === 'sequelize') {
    await appendSequelizeEntity(
      repoDir,
      cwd,
      componentPaths.express,
      'express',
      config,
      generated,
    );
  } else if (genExpress && orm === 'typeorm') {
    await appendTypeormEntity(
      repoDir,
      cwd,
      componentPaths.express,
      'express',
      config,
      generated,
    );
  }

  if (hasGo && (orm === 'prisma' || orm === 'gorm' || orm === undefined)) {
    const { instances } = await discoverComponentsFromMarkers(cwd);
    const goInstances = instances.filter((item) => item.type === 'go');
    const dirs =
      goInstances.length > 0
        ? goInstances.map((item) => item.path)
        : [componentPaths.go];
    for (const dir of dirs) {
      await appendGoEntity(cwd, dir, config, generated);
    }
  }

  if (hasGo && orm === 'sqlc') {
    const { instances } = await discoverComponentsFromMarkers(cwd);
    const goInstances = instances.filter((item) => item.type === 'go');
    const dirs =
      goInstances.length > 0
        ? goInstances.map((item) => item.path)
        : [componentPaths.go];
    for (const dir of dirs) {
      await appendSqlcEntity(repoDir, cwd, dir, config, generated);
    }
  }

  if (hasGo && orm === 'ent') {
    const { instances } = await discoverComponentsFromMarkers(cwd);
    const goInstances = instances.filter((item) => item.type === 'go');
    const dirs =
      goInstances.length > 0
        ? goInstances.map((item) => item.path)
        : [componentPaths.go];
    for (const dir of dirs) {
      await appendEntEntity(repoDir, cwd, dir, config, generated);
    }
  }

  if (hasRust && orm === 'seaorm') {
    const { instances } = await discoverComponentsFromMarkers(cwd);
    const rustInstances = instances.filter((item) => item.type === 'rust');
    const dirs =
      rustInstances.length > 0
        ? rustInstances.map((item) => item.path)
        : [componentPaths.rust ?? 'rust'];
    for (const dir of dirs) {
      await appendSeaormEntity(cwd, dir, config, generated);
    }
  }

  if (hasLaravel && orm === 'eloquent') {
    const { instances } = await discoverComponentsFromMarkers(cwd);
    const laravelInstances = instances.filter(
      (item) => item.type === 'laravel',
    );
    const dirs =
      laravelInstances.length > 0
        ? laravelInstances.map((item) => item.path)
        : [componentPaths.laravel ?? 'laravel'];
    for (const dir of dirs) {
      await appendEloquentEntity(cwd, dir, config, generated);
    }
  }

  const frontendDirs: string[] = [];
  if (hasVitejs) frontendDirs.push(componentPaths.vitejs);
  if (hasNextjs) frontendDirs.push(componentPaths.nextjs);
  for (const dir of frontendDirs) {
    const typesDir = join(cwd, dir, 'src/types');
    const fileName = toKebab(config.name) + '.ts';
    const filePath = join(typesDir, fileName);

    if (existsSync(filePath)) {
      p.log.warn(
        `${dir}/src/types/${fileName} already exists. Skipping frontend types.`,
      );
    } else {
      await mkdir(typesDir, { recursive: true });
      await writeFile(filePath, generateFrontendInterface(config));
      generated.push(`${dir}/src/types/${fileName}`);

      const barrelPath = join(typesDir, 'index.ts');
      const exportLine = `export * from './${toKebab(config.name)}';`;
      if (existsSync(barrelPath)) {
        const content = await readFile(barrelPath, 'utf-8');
        if (!content.includes(exportLine)) {
          await writeFile(
            barrelPath,
            content.trimEnd() + '\n' + exportLine + '\n',
          );
        }
      } else {
        await writeFile(barrelPath, exportLine + '\n');
      }
      generated.push(`${dir}/src/types/index.ts`);
    }
  }

  if (hasMobile) {
    const dir = componentPaths.mobile;
    const entityDir = join(cwd, dir, 'lib/entities', toSnake(config.name));
    const modelPath = join(entityDir, 'model.dart');

    if (existsSync(modelPath)) {
      p.log.warn(
        `${dir}/lib/entities/${toSnake(config.name)}/model.dart already exists. Skipping mobile model.`,
      );
    } else {
      await mkdir(entityDir, { recursive: true });
      await writeFile(modelPath, generateDartModel(config));
      generated.push(`${dir}/lib/entities/${toSnake(config.name)}/model.dart`);
    }
  }

  if (generated.length === 0) {
    p.log.warn('Nothing generated.');
    p.outro('');
    return;
  }

  p.log.success('Generated:');
  for (const f of generated) {
    p.log.info(`  ${f}`);
  }

  const className = toPascal(config.name);

  if (genFastapi) {
    p.log.info('');
    p.log.info('FastAPI next steps:');
    p.log.info(
      `  alembic revision --autogenerate -m "add ${config.tableName}"`,
    );
    p.log.info('  alembic upgrade head');
  }

  if (genFastify && orm === 'prisma') {
    p.log.info('');
    p.log.info('Fastify next steps:');
    p.log.info(
      `  ${pm.prismaExec} migrate dev --name add_${toSnake(config.name)}`,
    );
  }

  if (genDrizzle) {
    p.log.info('');
    p.log.info('Drizzle next steps:');
    p.log.info(`  ${pm.exec} drizzle-kit generate`);
    p.log.info(`  ${pm.exec} drizzle-kit migrate`);
  }

  if (genSequelize) {
    p.log.info('');
    p.log.info('Sequelize next steps:');
    p.log.info(
      `  ${pm.run} db:sync   # syncs the schema against $DATABASE_URL`,
    );
  }

  if (genTypeorm) {
    p.log.info('');
    p.log.info('TypeORM next steps:');
    p.log.info(
      `  ${pm.run} db:sync   # syncs the schema against $DATABASE_URL`,
    );
  }

  if (hasRust && orm === 'seaorm') {
    p.log.info('');
    p.log.info('Rust (SeaORM) next steps:');
    p.log.info(
      `  add a migration creating the ${config.tableName} table, then run it against $DATABASE_URL`,
    );
  }

  if (hasLaravel && orm === 'eloquent') {
    p.log.info('');
    p.log.info('Laravel next steps:');
    p.log.info(`  php artisan migrate`);
  }

  if (hasVitejs || hasNextjs) {
    p.log.info('');
    p.log.info('Frontend usage:');
    p.log.info(
      `  import type { ${className} } from '../types/${toKebab(config.name)}';`,
    );
    p.log.info(
      `  const { data } = await api.list<${className}>('${config.apiPrefix}');`,
    );
  }

  if (hasMobile) {
    p.log.info('');
    p.log.info('Mobile usage:');
    p.log.info(`  final item = ${className}.fromJson(json);`);
  }

  p.outro(`Entity ${className} created.`);
}
