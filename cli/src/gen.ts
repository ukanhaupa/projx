import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';
import {
  type PackageManager,
  discoverComponentsFromMarkers,
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
    const required = nameType.endsWith('!');
    const name = toSnake(required ? nameType.slice(0, -1) : nameType);
    const type = (rest[0] || 'string') as FieldType;
    const modifiers = new Set(rest.slice(1).map((item) => item.toLowerCase()));
    return {
      name,
      type,
      required: required || true,
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

function addonGenEntityPath(orm: string, fileName: string): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(thisFile, '../../src/addons/orms', orm, 'gen-entity', fileName);
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
  orm: string,
  fileName: string,
  vars: Record<string, string>,
): Promise<string> {
  const path = addonGenEntityPath(orm, fileName);
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
    const entitySource = await fillTemplate('typeorm', 'entity.ts', vars);
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
    const modelSource = await fillTemplate('sequelize', 'model.ts', vars);
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

  if (!existsSync(schemaPath)) {
    await writeFile(
      schemaPath,
      `import { boolean, date, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';\n\n${tableSource}\n`,
    );
    generated.push(`${dir}/src/db/schema.ts`);
  } else {
    const content = await readFile(schemaPath, 'utf-8');
    if (!content.includes(`export const ${tableConst} = pgTable(`)) {
      let updated = content;
      const importLine =
        "import { boolean, date, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';";
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
            for (const name of [
              'boolean',
              'date',
              'integer',
              'jsonb',
              'pgTable',
              'text',
              'timestamp',
              'uuid',
            ]) {
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

// --- Main ---

type BackendTarget = 'fastapi' | 'fastify' | 'express';

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
    config.primaryBackend === 'fastapi' ||
    config.primaryBackend === 'fastify' ||
    config.primaryBackend === 'express'
  ) {
    return config.primaryBackend;
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

  const { components: discovered, paths: componentPaths } =
    await discoverComponentsFromMarkers(cwd);

  const hasFastapi = discovered.includes('fastapi');
  const hasFastify = discovered.includes('fastify');
  const hasExpress = discovered.includes('express');
  const hasFrontend = discovered.includes('frontend');
  const hasMobile = discovered.includes('mobile');

  if (!hasFastapi && !hasFastify && !hasExpress) {
    p.log.error(
      'No backend component found. Need fastapi, fastify, or express.',
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
      cwd,
      componentPaths.fastify,
      'fastify',
      config,
      generated,
    );
  } else if (genFastify && orm === 'sequelize') {
    await appendSequelizeEntity(
      cwd,
      componentPaths.fastify,
      'fastify',
      config,
      generated,
    );
  } else if (genFastify && orm === 'typeorm') {
    await appendTypeormEntity(
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
      cwd,
      componentPaths.express,
      'express',
      config,
      generated,
    );
  } else if (genExpress && orm === 'sequelize') {
    await appendSequelizeEntity(
      cwd,
      componentPaths.express,
      'express',
      config,
      generated,
    );
  } else if (genExpress && orm === 'typeorm') {
    await appendTypeormEntity(
      cwd,
      componentPaths.express,
      'express',
      config,
      generated,
    );
  }

  if (hasFrontend) {
    const dir = componentPaths.frontend;
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

  if (hasFrontend) {
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
