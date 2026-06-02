import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import {
  BACKEND_COMPONENTS,
  discoverComponentsFromMarkers,
  type Component,
  type ComponentPaths,
} from './utils.js';

export interface BackendField {
  name: string;
  json_name: string;
  db_name: string;
  type: string;
  nullable: boolean;
  primary_key?: boolean;
  unique?: boolean;
}

export interface BackendEntity {
  name: string;
  table_name: string;
  base_path: string;
  api_path: string;
  soft_delete: boolean;
  searchable_fields: string[];
  hidden_fields: string[];
  fields: BackendField[];
}

export interface SchemasDocument {
  entities: Record<string, BackendEntity>;
}

export const META_SCHEMAS_PATH = '/api/v1/_meta/schemas';

export const DEFAULT_BACKEND_URLS: Record<
  (typeof BACKEND_COMPONENTS)[number],
  string
> = {
  fastify: 'http://localhost:3000',
  express: 'http://localhost:3000',
  fastapi: 'http://localhost:8000',
  go: 'http://localhost:8080',
  rust: 'http://localhost:8080',
  laravel: 'http://localhost:8000',
};

export interface SyncOptions {
  backend?: (typeof BACKEND_COMPONENTS)[number];
  url?: string;
  fetchImpl?: typeof fetch;
}

export function pickBackend(
  components: Component[],
  override?: SyncOptions['backend'],
): (typeof BACKEND_COMPONENTS)[number] {
  if (override) {
    if (!components.includes(override)) {
      throw new Error(
        `Backend '${override}' not found in this project. Discovered: ${components.join(', ')}.`,
      );
    }
    return override;
  }
  for (const b of BACKEND_COMPONENTS) {
    if (components.includes(b)) return b;
  }
  throw new Error(
    `No backend component found. Need one of: ${BACKEND_COMPONENTS.join(', ')}.`,
  );
}

export function resolveBaseUrl(
  backend: (typeof BACKEND_COMPONENTS)[number],
  override?: string,
): string {
  const url = override || DEFAULT_BACKEND_URLS[backend];
  return url.replace(/\/+$/, '');
}

export async function fetchSchemas(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SchemasDocument> {
  const res = await fetchImpl(`${baseUrl}${META_SCHEMAS_PATH}`);
  if (!res.ok) {
    throw new Error(
      `GET ${baseUrl}${META_SCHEMAS_PATH} failed: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as SchemasDocument;
  if (!body || typeof body !== 'object' || !body.entities) {
    throw new Error(
      `Invalid schemas response: missing 'entities' from ${baseUrl}${META_SCHEMAS_PATH}.`,
    );
  }
  return body;
}

const GO_TS_TYPE_MAP: Record<string, string> = {
  string: 'string',
  bool: 'boolean',
  int: 'number',
  int8: 'number',
  int16: 'number',
  int32: 'number',
  int64: 'number',
  uint: 'number',
  uint8: 'number',
  uint16: 'number',
  uint32: 'number',
  uint64: 'number',
  float32: 'number',
  float64: 'number',
  'time.Time': 'string',
};

export function tsTypeFor(goType: string): string {
  if (GO_TS_TYPE_MAP[goType]) return GO_TS_TYPE_MAP[goType];
  if (/(^|\.)Time$/.test(goType)) return 'string';
  if (/^uuid\./i.test(goType)) return 'string';
  return 'unknown';
}

export function toPascal(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

export function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

export function renderInterface(entity: BackendEntity): string {
  const className = toPascal(entity.name);
  const lines: string[] = [`export interface ${className} {`];
  for (const f of entity.fields) {
    const optional = f.nullable ? '?' : '';
    lines.push(`  ${f.json_name}${optional}: ${tsTypeFor(f.type)};`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

async function writeTypes(
  frontendDir: string,
  doc: SchemasDocument,
  logger: { info: (s: string) => void; warn: (s: string) => void },
): Promise<string[]> {
  const typesDir = join(frontendDir, 'src/types');
  await mkdir(typesDir, { recursive: true });
  const written: string[] = [];

  for (const entity of Object.values(doc.entities)) {
    const fileName = `${toKebab(entity.name)}.ts`;
    const filePath = join(typesDir, fileName);
    await writeFile(filePath, renderInterface(entity));
    written.push(`src/types/${fileName}`);
    logger.info(`  wrote ${fileName}`);
  }

  const barrelPath = join(typesDir, 'index.ts');
  const exportLines = Object.values(doc.entities).map(
    (e) => `export * from './${toKebab(e.name)}';`,
  );

  let existing = '';
  if (existsSync(barrelPath)) {
    existing = await readFile(barrelPath, 'utf-8');
  }
  const existingLines = new Set(
    existing
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
  for (const line of exportLines) existingLines.add(line);
  await writeFile(
    barrelPath,
    Array.from(existingLines).sort().join('\n') + '\n',
  );

  return written;
}

export async function syncTypes(
  cwd: string,
  options: SyncOptions = {},
): Promise<{ backend: string; baseUrl: string; written: string[] }> {
  const { components, paths } = await discoverComponentsFromMarkers(cwd);
  if (!components.includes('frontend')) {
    throw new Error(
      `No frontend component found. sync writes types into <frontend>/src/types.`,
    );
  }
  const backend = pickBackend(components, options.backend);
  const baseUrl = resolveBaseUrl(backend, options.url);
  const doc = await fetchSchemas(baseUrl, options.fetchImpl);

  const frontendDir = join(cwd, (paths as ComponentPaths).frontend);
  const written = await writeTypes(frontendDir, doc, {
    info: (s) => p.log.info(s),
    warn: (s) => p.log.warn(s),
  });
  return { backend, baseUrl, written };
}

export async function sync(
  cwd: string,
  options: SyncOptions = {},
): Promise<void> {
  p.intro('projx sync');
  try {
    const { backend, baseUrl, written } = await syncTypes(cwd, options);
    p.log.success(
      `Synced ${written.length} type file(s) from ${backend} at ${baseUrl}.`,
    );
    p.outro('');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    p.log.error(msg);
    process.exit(1);
  }
}
