import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import {
  type Component,
  discoverComponentPaths,
  toKebab,
  toSnake,
} from './utils.js';

interface ProjxConfig {
  version: string;
  components: Component[];
}

interface MetaField {
  key: string;
  label: string;
  type: string;
  nullable: boolean;
  is_auto: boolean;
  is_primary_key: boolean;
  in_create: boolean;
  in_update: boolean;
  field_type: string;
  max_length?: number;
  has_foreign_key: boolean;
}

interface MetaEntity {
  name: string;
  table_name: string;
  api_prefix: string;
  readonly: boolean;
  soft_delete: boolean;
  fields: MetaField[];
}

interface MetaResponse {
  entities: MetaEntity[];
}

function toPascal(s: string): string {
  return s.replace(/(?:^|[_\-\s])([a-zA-Z])/g, (_, c) => c.toUpperCase());
}

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function metaTypeToTs(
  type: string,
  fieldType: string,
  nullable: boolean,
): string {
  const base = (() => {
    switch (type) {
      case 'str':
        return 'string';
      case 'int':
      case 'float':
        return 'number';
      case 'bool':
        return 'boolean';
      case 'datetime':
      case 'date':
        return 'string';
      case 'dict':
        return 'Record<string, unknown>';
      default:
        return 'unknown';
    }
  })();
  return nullable ? `${base} | null` : base;
}

function metaTypeToDart(type: string, nullable: boolean): string {
  const base = (() => {
    switch (type) {
      case 'str':
        return 'String';
      case 'int':
        return 'int';
      case 'float':
        return 'double';
      case 'bool':
        return 'bool';
      case 'datetime':
      case 'date':
        return 'DateTime';
      case 'dict':
        return 'Map<String, dynamic>';
      default:
        return 'dynamic';
    }
  })();
  return nullable ? `${base}?` : base;
}

function dartFromJsonExpr(
  key: string,
  type: string,
  nullable: boolean,
): string {
  const accessor = `json['${key}']`;
  const isDate = type === 'datetime' || type === 'date';

  if (isDate && nullable)
    return `${accessor} != null ? DateTime.parse(${accessor} as String) : null`;
  if (isDate) return `DateTime.parse(${accessor} as String)`;
  if (type === 'dict' && nullable)
    return `${accessor} as Map<String, dynamic>?`;
  if (type === 'dict') return `${accessor} as Map<String, dynamic>`;

  const dartT = (() => {
    switch (type) {
      case 'str':
        return 'String';
      case 'int':
        return 'int';
      case 'float':
        return 'double';
      case 'bool':
        return 'bool';
      default:
        return 'dynamic';
    }
  })();

  return nullable ? `${accessor} as ${dartT}?` : `${accessor} as ${dartT}`;
}

function dartToJsonExpr(key: string, camel: string, type: string): string {
  const isDate = type === 'datetime' || type === 'date';
  if (isDate) return `'${key}': ${camel}?.toIso8601String()`;
  return `'${key}': ${camel}`;
}

function generateTsInterface(entity: MetaEntity): string {
  const className = toPascal(entity.name);
  const lines: string[] = [];

  // Main interface
  lines.push(`export interface ${className} {`);
  for (const f of entity.fields) {
    lines.push(
      `  ${f.key}: ${metaTypeToTs(f.type, f.field_type, f.nullable)};`,
    );
  }
  lines.push(`}`);
  lines.push('');

  // Create interface
  const createFields = entity.fields.filter((f) => f.in_create);
  lines.push(`export interface Create${className} {`);
  for (const f of createFields) {
    const optional = f.nullable ? '?' : '';
    lines.push(
      `  ${f.key}${optional}: ${metaTypeToTs(f.type, f.field_type, f.nullable)};`,
    );
  }
  lines.push(`}`);
  lines.push('');

  // Update interface
  const updateFields = entity.fields.filter((f) => f.in_update);
  lines.push(`export interface Update${className} {`);
  for (const f of updateFields) {
    lines.push(`  ${f.key}?: ${metaTypeToTs(f.type, f.field_type, true)};`);
  }
  lines.push(`}`);
  lines.push('');

  return lines.join('\n');
}

function generateDartModel(entity: MetaEntity): string {
  const className = toPascal(entity.name);
  const lines: string[] = [];

  const fields = entity.fields.map((f) => ({
    snake: f.key,
    camel: toCamel(f.key),
    type: metaTypeToDart(f.type, f.nullable),
    nullable: f.nullable,
    metaType: f.type,
  }));

  lines.push(`class ${className} {`);

  for (const f of fields) {
    lines.push(`  final ${f.type} ${f.camel};`);
  }
  lines.push('');

  lines.push(`  const ${className}({`);
  for (const f of fields) {
    if (f.nullable) {
      lines.push(`    this.${f.camel},`);
    } else {
      lines.push(`    required this.${f.camel},`);
    }
  }
  lines.push(`  });`);
  lines.push('');

  lines.push(`  factory ${className}.fromJson(Map<String, dynamic> json) {`);
  lines.push(`    return ${className}(`);
  for (const f of fields) {
    lines.push(
      `      ${f.camel}: ${dartFromJsonExpr(f.snake, f.metaType, f.nullable)},`,
    );
  }
  lines.push(`    );`);
  lines.push(`  }`);
  lines.push('');

  lines.push(`  Map<String, dynamic> toJson() {`);
  lines.push(`    return {`);
  for (const f of fields) {
    lines.push(`      ${dartToJsonExpr(f.snake, f.camel, f.metaType)},`);
  }
  lines.push(`    };`);
  lines.push(`  }`);
  lines.push('');

  lines.push(`  ${className} copyWith({`);
  for (const f of fields) {
    lines.push(`    ${f.type.replace('?', '')}? ${f.camel},`);
  }
  lines.push(`  }) {`);
  lines.push(`    return ${className}(`);
  for (const f of fields) {
    lines.push(`      ${f.camel}: ${f.camel} ?? this.${f.camel},`);
  }
  lines.push(`    );`);
  lines.push(`  }`);

  lines.push(`}`);
  lines.push('');

  return lines.join('\n');
}

export async function sync(cwd: string, url?: string): Promise<void> {
  p.intro('projx sync');

  const configPath = join(cwd, '.projx');
  if (!existsSync(configPath)) {
    p.log.error("No .projx file found. Run 'npx create-projx init' first.");
    process.exit(1);
  }

  const projxConfig: ProjxConfig = JSON.parse(
    await readFile(configPath, 'utf-8'),
  );
  const componentPaths = await discoverComponentPaths(
    cwd,
    projxConfig.components,
  );

  const hasFrontend = projxConfig.components.includes('frontend');
  const hasMobile = projxConfig.components.includes('mobile');

  if (!hasFrontend && !hasMobile) {
    p.log.error('No frontend or mobile component found. Nothing to sync.');
    process.exit(1);
  }

  // Detect backend URL
  const metaUrl = url || detectMetaUrl(cwd);

  const spinner = p.spinner();
  spinner.start(`Fetching metadata from ${metaUrl}`);

  let meta: MetaResponse;
  try {
    const res = await fetch(metaUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    meta = (await res.json()) as MetaResponse;
  } catch (err) {
    spinner.stop('Failed.');
    p.log.error(`Could not fetch ${metaUrl}: ${err}`);
    p.log.info('Make sure your backend is running.');
    p.log.info(
      'Or specify URL: projx sync --url http://localhost:8000/api/v1/_meta',
    );
    process.exit(1);
  }

  spinner.stop(`Fetched ${meta.entities.length} entity(s).`);

  const generated: string[] = [];

  if (hasFrontend) {
    const dir = componentPaths.frontend;
    const typesDir = join(cwd, dir, 'src/types');
    await mkdir(typesDir, { recursive: true });

    const barrelExports: string[] = [];

    for (const entity of meta.entities) {
      const fileName = toKebab(toSnake(entity.name)) + '.ts';
      const filePath = join(typesDir, fileName);
      await writeFile(filePath, generateTsInterface(entity));
      generated.push(`${dir}/src/types/${fileName}`);
      barrelExports.push(`export * from './${toKebab(toSnake(entity.name))}';`);
    }

    await writeFile(
      join(typesDir, 'index.ts'),
      barrelExports.join('\n') + '\n',
    );
    generated.push(`${dir}/src/types/index.ts`);
  }

  if (hasMobile) {
    const dir = componentPaths.mobile;

    for (const entity of meta.entities) {
      const entityDir = join(cwd, dir, 'lib/entities', toSnake(entity.name));
      await mkdir(entityDir, { recursive: true });
      const modelPath = join(entityDir, 'model.dart');
      await writeFile(modelPath, generateDartModel(entity));
      generated.push(`${dir}/lib/entities/${toSnake(entity.name)}/model.dart`);
    }
  }

  p.log.success(`Synced ${meta.entities.length} entity(s):`);
  for (const f of generated) {
    p.log.info(`  ${f}`);
  }

  if (hasFrontend) {
    p.log.info('');
    p.log.info('Frontend usage:');
    for (const entity of meta.entities) {
      const className = toPascal(entity.name);
      p.log.info(
        `  import type { ${className} } from '../types/${toKebab(toSnake(entity.name))}';`,
      );
    }
  }

  p.outro('Types are up to date.');
}

function detectMetaUrl(cwd: string): string {
  // Check .env files for API URL
  const envFiles = ['.env', '.env.dev', '.env.local'];
  for (const envFile of envFiles) {
    const envPath = join(cwd, envFile);
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, 'utf-8');
        const match = content.match(/VITE_API_URL\s*=\s*(.+)/);
        if (match) {
          const base = match[1].trim().replace(/["']/g, '');
          return `${base}/api/v1/_meta`;
        }
      } catch {
        // continue
      }
    }
  }

  // Check frontend .env
  const frontendEnvFiles = [
    'frontend/.env',
    'frontend/.env.local',
    'frontend/.env.dev',
  ];
  for (const envFile of frontendEnvFiles) {
    const envPath = join(cwd, envFile);
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, 'utf-8');
        const match = content.match(/VITE_API_URL\s*=\s*(.+)/);
        if (match) {
          const base = match[1].trim().replace(/["']/g, '');
          return `${base}/api/v1/_meta`;
        }
      } catch {
        // continue
      }
    }
  }

  return 'http://localhost:8000/api/v1/_meta';
}
