import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import {
  chmod,
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  copyFile,
} from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  type Component,
  type ComponentInstance,
  type ComponentPaths,
  DEFAULT_COMPONENT_SKIP_PATTERNS,
  DEFAULT_ROOT_SKIP_PATTERNS,
  copyComponent,
  copyStaticFiles,
  readComponentMarker,
  readProjxConfig,
  renderEjsInDir,
  replaceInFile,
  replaceInDir,
  toSnake,
  upsertComponentMarker,
  writeProjxConfig,
} from "./utils.js";
import {
  generateDockerCompose,
  generateCiYml,
  generatePreCommit,
  generateReadme,
  generateSetupSh,
  generateVscodeSettings,
} from "./generators/index.js";

export interface GeneratorVars {
  projectName: string;
  components: Component[];
  paths: ComponentPaths;
  instances?: ComponentInstance[];
  nameOverrides?: Partial<Record<Component, string>>;
  [key: string]: unknown;
}

export interface MergeResult {
  status: "clean" | "merged" | "conflicts";
  mergedFiles?: string[];
  conflictedFiles?: string[];
}

export const BASELINE_REF = "refs/projx/baseline";

async function migrateComponentMarkers(
  cwd: string,
  components: Component[],
  componentPaths: ComponentPaths,
  applyDefaults: boolean,
): Promise<void> {
  const { readComponentMarker, writeComponentMarker } =
    await import("./utils.js");
  for (const component of components) {
    const dir = componentPaths[component];
    const markerDir = join(cwd, dir);
    if (!existsSync(markerDir)) continue;
    const marker = await readComponentMarker(markerDir);
    if (!marker) continue;
    const next = { ...marker };
    if (applyDefaults) {
      const defaults = DEFAULT_COMPONENT_SKIP_PATTERNS[component] ?? [];
      next.skip = [...new Set([...marker.skip, ...defaults])];
    }
    await writeComponentMarker(markerDir, next);
  }
}

async function writeManagedProjx(
  cwd: string,
  version: string,
  vars: GeneratorVars,
  applyDefaults: boolean,
): Promise<void> {
  const existing = await readProjxConfig(cwd);
  delete existing.components;
  const today = new Date().toISOString().split("T")[0];
  const merged: Record<string, unknown> = {
    ...existing,
    version,
    updatedAt: today,
  };
  const pmObj = vars.pm as { name?: string } | undefined;
  if (pmObj?.name && !merged.packageManager) {
    merged.packageManager = pmObj.name;
  }
  if (typeof vars.orm === "string" && !merged.orm) {
    merged.orm = vars.orm;
  }
  if (applyDefaults && !merged.defaultsApplied) {
    const userSkip = Array.isArray(merged.skip)
      ? (merged.skip as string[])
      : [];
    merged.skip = [...new Set([...userSkip, ...DEFAULT_ROOT_SKIP_PATTERNS])];
    merged.defaultsApplied = true;
  }
  await writeProjxConfig(cwd, merged);
}

export function matchesSkip(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === "**") return true;
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      if (filePath.startsWith(prefix + "/") || filePath === prefix) return true;
    }
    if (pattern.startsWith("**/")) {
      const suffix = pattern.slice(3);
      if (suffix.startsWith("*.")) {
        const ext = suffix.slice(1);
        if (filePath.endsWith(ext)) return true;
      } else if (filePath.endsWith(suffix) || filePath.includes("/" + suffix)) {
        return true;
      }
    }
    if (pattern.startsWith("*.")) {
      const ext = pattern.slice(1);
      if (filePath.endsWith(ext)) return true;
    }
    if (filePath === pattern) return true;
  }
  return false;
}

// --- Baseline ref management ---

export function saveBaselineRef(cwd: string): void {
  try {
    const head = execSync("git rev-parse HEAD", { cwd, stdio: "pipe" })
      .toString()
      .trim();
    execSync(`git update-ref ${BASELINE_REF} ${head}`, { cwd, stdio: "pipe" });
  } catch {
    // non-critical
  }
}

export function getBaselineRef(cwd: string): string | null {
  // Try explicit ref first
  try {
    return execSync(`git rev-parse --verify ${BASELINE_REF}`, {
      cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();
  } catch {
    // no explicit ref
  }

  // Fallback: find the commit that last modified .projx (= last template apply)
  try {
    const sha = execSync("git log -1 --format=%H -- .projx", {
      cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();
    if (sha) return sha;
  } catch {
    // no history
  }

  return null;
}

export function getFileAtRef(
  cwd: string,
  ref: string,
  filePath: string,
): string | null {
  try {
    return execSync(`git show ${ref}:"${filePath}"`, {
      cwd,
      stdio: "pipe",
    }).toString();
  } catch {
    return null;
  }
}

// --- Per-file 3-way merge ---

function mergeFileThreeWay(
  oursPath: string,
  baseContent: string,
  theirsContent: string,
): boolean {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseTmp = join(tmpdir(), `projx-base-${id}`);
  const theirsTmp = join(tmpdir(), `projx-theirs-${id}`);

  try {
    writeFileSync(baseTmp, baseContent);
    writeFileSync(theirsTmp, theirsContent);
    execSync(
      `git merge-file -L "your changes" -L "previous projx baseline" -L "new projx template" "${oursPath}" "${baseTmp}" "${theirsTmp}"`,
      { stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  } finally {
    try {
      unlinkSync(baseTmp);
    } catch {
      /* */
    }
    try {
      unlinkSync(theirsTmp);
    } catch {
      /* */
    }
  }
}

export async function collectAllFiles(
  dir: string,
  base: string,
): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const results: string[] = [];

  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        results.push(full.slice(base.length + 1));
      }
    }
  };

  await walk(dir);
  return results;
}

function buildPathFallbacks(
  componentPaths: ComponentPaths,
): Record<string, string> {
  const fallbacks: Record<string, string> = {};
  for (const [component, dir] of Object.entries(componentPaths)) {
    if (dir !== component) fallbacks[dir] = component;
  }
  return fallbacks;
}

function lookupBaseContent(
  cwd: string,
  baselineRef: string,
  file: string,
  pathFallbacks: Record<string, string>,
): string | null {
  const direct = getFileAtRef(cwd, baselineRef, file);
  if (direct !== null) return direct;

  const slash = file.indexOf("/");
  if (slash === -1) return null;
  const topDir = file.slice(0, slash);
  const canonical = pathFallbacks[topDir];
  if (!canonical) return null;
  return getFileAtRef(cwd, baselineRef, canonical + file.slice(slash));
}

async function tryThreeWayMerge(
  cwd: string,
  templateDir: string,
  baselineRef: string,
  componentPaths: ComponentPaths,
): Promise<{ merged: string[]; conflicted: string[] }> {
  const templateFiles = await collectAllFiles(templateDir, templateDir);
  const merged: string[] = [];
  const conflicted: string[] = [];
  const pathFallbacks = buildPathFallbacks(componentPaths);

  for (const file of templateFiles) {
    if (file === ".projx") continue;
    const isMarker =
      file.endsWith("/.projx-component") || file === ".projx-component";
    const oursPath = join(cwd, file);
    if (isMarker && existsSync(oursPath)) continue;
    if (!existsSync(oursPath)) {
      await mkdir(dirname(oursPath), { recursive: true });
      await copyFile(join(templateDir, file), oursPath);
      merged.push(file);
      continue;
    }
    if (isMarker) continue;
    const baseContent = lookupBaseContent(
      cwd,
      baselineRef,
      file,
      pathFallbacks,
    );
    if (baseContent === null) continue;

    let theirsContent: string;
    try {
      theirsContent = await readFile(join(templateDir, file), "utf-8");
    } catch {
      continue;
    }

    const oursContent = await readFile(oursPath, "utf-8");

    if (theirsContent === baseContent) continue;

    if (oursContent === baseContent) {
      await writeFile(oursPath, theirsContent);
      merged.push(file);
      continue;
    }

    if (oursContent === theirsContent) continue;

    const clean = mergeFileThreeWay(oursPath, baseContent, theirsContent);
    if (clean) {
      merged.push(file);
    } else {
      conflicted.push(file);
    }
  }

  return { merged, conflicted };
}

// --- Worktree helpers ---

function createOrphanWorktree(cwd: string): {
  worktree: string;
  branch: string;
} {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const branch = `projx/tmp-${id}`;
  const worktree = join(tmpdir(), `projx-wt-${id}`);

  try {
    execSync("git worktree prune", { cwd, stdio: "pipe" });
  } catch {
    // non-critical
  }

  execSync(`git worktree add --orphan -b ${branch} "${worktree}"`, {
    cwd,
    stdio: "pipe",
  });

  return { worktree, branch };
}

function cleanupWorktree(cwd: string, worktree: string, branch: string): void {
  try {
    execSync(`git worktree remove "${worktree}" --force`, {
      cwd,
      stdio: "pipe",
    });
  } catch {
    try {
      rm(worktree, { recursive: true, force: true });
      execSync("git worktree prune", { cwd, stdio: "pipe" });
    } catch {
      // best effort
    }
  }

  try {
    execSync(`git branch -D ${branch}`, { cwd, stdio: "pipe" });
  } catch {
    // branch may already be gone
  }
}

// --- Skip file removal ---

async function removeSkippedFiles(
  dir: string,
  skipPatterns: string[],
  realDir?: string,
): Promise<void> {
  if (skipPatterns.length === 0) return;

  const { readdir, unlink } = await import("node:fs/promises");

  const walk = async (current: string, base: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      const rel = full.slice(base.length + 1);

      if (entry.isDirectory()) {
        await walk(full, base);
      } else if (entry.name !== ".projx-component") {
        const targetRel = rel.endsWith(".ejs")
          ? rel.slice(0, -".ejs".length)
          : rel;
        if (
          !matchesSkip(targetRel, skipPatterns) &&
          !matchesSkip(rel, skipPatterns)
        )
          continue;
        if (realDir && !existsSync(join(realDir, targetRel))) continue;
        await unlink(full);
      }
    }
  };

  await walk(dir, dir);
}

// --- Template writing ---

export interface WriteTemplateOptions {
  componentSkips?: Record<string, string[]>;
  rootSkip?: string[];
  applyDefaults?: boolean;
  realCwd?: string;
  extraInstances?: { type: Component; path: string }[];
  instancesToScaffold?: ComponentInstance[];
}

export async function writeTemplateToDir(
  dest: string,
  repoDir: string,
  components: Component[],
  componentPaths: ComponentPaths,
  vars: GeneratorVars,
  version: string,
  options: WriteTemplateOptions = {},
): Promise<void> {
  const {
    componentSkips,
    rootSkip,
    applyDefaults = false,
    realCwd = dest,
    extraInstances = [],
    instancesToScaffold,
  } = options;
  const name = vars.projectName;
  const nameSnake = toSnake(name);

  const primaryInstances: ComponentInstance[] = components.map((type) => ({
    type,
    path: componentPaths[type],
  }));
  const allInstances: ComponentInstance[] = [
    ...primaryInstances,
    ...extraInstances,
  ];
  const toScaffold = instancesToScaffold ?? allInstances;

  for (const inst of toScaffold) {
    await writeOneInstance(inst, {
      dest,
      repoDir,
      vars,
      componentPaths,
      realCwd,
      applyDefaults,
      baseSkip: componentSkips?.[inst.type] ?? [],
      projectName: name,
      nameSnake,
    });
  }

  const hasBackend =
    components.includes("fastapi") ||
    components.includes("fastify") ||
    components.includes("express");

  const userSkip = rootSkip ?? [];
  const defaultRootSkip = applyDefaults ? DEFAULT_ROOT_SKIP_PATTERNS : [];
  const effectiveSkip = [...new Set([...userSkip, ...defaultRootSkip])];
  const shouldWrite = (file: string) => {
    if (!matchesSkip(file, effectiveSkip)) return true;
    return !existsSync(join(realCwd, file));
  };

  if (hasBackend || components.includes("frontend")) {
    if (shouldWrite("docker-compose.yml"))
      await writeFile(
        join(dest, "docker-compose.yml"),
        await generateDockerCompose(vars),
      );
  }

  if (shouldWrite("README.md"))
    await writeFile(join(dest, "README.md"), await generateReadme(vars));

  if (shouldWrite(".githooks/pre-commit")) {
    await mkdir(join(dest, ".githooks"), { recursive: true });
    await writeFile(
      join(dest, ".githooks/pre-commit"),
      await generatePreCommit(vars),
    );
    await chmod(join(dest, ".githooks/pre-commit"), 0o755);
  }

  if (shouldWrite(".github/workflows/ci.yml")) {
    await mkdir(join(dest, ".github/workflows"), { recursive: true });
    await writeFile(
      join(dest, ".github/workflows/ci.yml"),
      await generateCiYml(vars),
    );
  }

  if (shouldWrite("scripts/setup.sh")) {
    await mkdir(join(dest, "scripts"), { recursive: true });
    await writeFile(
      join(dest, "scripts/setup.sh"),
      await generateSetupSh(vars),
    );
    await chmod(join(dest, "scripts/setup.sh"), 0o755);
  }

  await copyStaticFiles(repoDir, dest);

  if (shouldWrite(".vscode/settings.json")) {
    await mkdir(join(dest, ".vscode"), { recursive: true });
    await writeFile(
      join(dest, ".vscode/settings.json"),
      generateVscodeSettings(vars),
    );
  }

  await writeManagedProjx(dest, version, vars, applyDefaults);
}

interface WriteOneOpts {
  dest: string;
  repoDir: string;
  vars: GeneratorVars;
  componentPaths: ComponentPaths;
  realCwd: string;
  applyDefaults: boolean;
  baseSkip: string[];
  projectName: string;
  nameSnake: string;
}

async function writeOneInstance(
  inst: ComponentInstance,
  opts: WriteOneOpts,
): Promise<void> {
  const {
    dest,
    repoDir,
    vars,
    componentPaths,
    realCwd,
    applyDefaults,
    baseSkip,
    projectName,
    nameSnake,
  } = opts;
  const { type, path: targetDir } = inst;

  const realMarker = await readComponentMarker(join(realCwd, targetDir));
  const isNewMarker = !realMarker;
  const shouldApplyComponentDefault = isNewMarker || applyDefaults;
  const markerSkip = realMarker?.skip ?? [];
  const defaultSkip = shouldApplyComponentDefault
    ? (DEFAULT_COMPONENT_SKIP_PATTERNS[type] ?? [])
    : [];
  const skipPatterns = [
    ...new Set([...baseSkip, ...markerSkip, ...defaultSkip]),
  ];

  const tmpDir = join(dest, "__cptmp__");
  await copyComponent(repoDir, type, tmpDir);
  const srcDir = join(tmpDir, type);

  if (skipPatterns.length > 0) {
    await removeSkippedFiles(srcDir, skipPatterns, join(realCwd, targetDir));
  }

  const outDir = join(dest, targetDir);
  await mkdir(outDir, { recursive: true });
  const { cp } = await import("node:fs/promises");
  if (existsSync(srcDir)) {
    await cp(srcDir, outDir, { recursive: true, force: true });
  }
  await rm(tmpDir, { recursive: true, force: true });

  const instancePaths: ComponentPaths = {
    ...componentPaths,
    [type]: targetDir,
  };
  await renderEjsInDir(outDir, { ...vars, paths: instancePaths });
  await applyOrmProviderToInstance(outDir, type, vars);

  await upsertComponentMarker(
    join(dest, targetDir),
    type,
    skipPatterns.length > 0 ? skipPatterns : undefined,
  );

  await substituteNamesForInstance(
    inst,
    dest,
    projectName,
    nameSnake,
    vars.nameOverrides,
  );
}

async function applyOrmProviderToInstance(
  dir: string,
  component: Component,
  vars: GeneratorVars,
): Promise<void> {
  if (vars.orm !== "drizzle") return;
  if (component === "fastify") {
    await applyDrizzleFastify(dir, vars);
  } else if (component === "express") {
    await applyDrizzleExpress(dir, vars);
  }
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
}

async function writeJsonObject(
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
}

function retargetPackageForDrizzle(pkg: Record<string, unknown>): void {
  if (typeof pkg.description === "string") {
    pkg.description = pkg.description.replace(/Prisma/g, "Drizzle");
  }
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  for (const key of Object.keys(scripts)) {
    if (key.startsWith("prisma:")) delete scripts[key];
  }
  scripts["db:generate"] = "drizzle-kit generate";
  scripts["db:migrate"] = "drizzle-kit migrate";
  scripts["db:push"] = "drizzle-kit push";
  pkg.scripts = scripts;

  const dependencies = (pkg.dependencies ?? {}) as Record<string, string>;
  delete dependencies["@prisma/client"];
  dependencies["drizzle-orm"] = "^0.44.5";
  dependencies.pg = "^8.16.3";
  pkg.dependencies = dependencies;

  const devDependencies = (pkg.devDependencies ?? {}) as Record<string, string>;
  delete devDependencies.prisma;
  devDependencies["@types/pg"] = "^8.15.5";
  devDependencies["drizzle-kit"] = "^0.31.4";
  pkg.devDependencies = devDependencies;
}

async function applyDrizzleFastify(
  dir: string,
  vars: GeneratorVars,
): Promise<void> {
  await rm(join(dir, "prisma"), { recursive: true, force: true });
  await rm(join(dir, "src/plugins/prisma.ts"), { force: true });
  await rm(join(dir, "src/lib/service-config.ts"), { force: true });
  await rm(join(dir, "src/modules/_base"), { recursive: true, force: true });
  await rm(join(dir, "src/modules/audit-logs"), {
    recursive: true,
    force: true,
  });
  await rm(join(dir, "tests/modules/audit-logs.test.ts"), { force: true });
  await rm(join(dir, "tests/modules/audit-middleware.test.ts"), {
    force: true,
  });
  await rm(join(dir, "tests/modules/auto-routes.test.ts"), { force: true });
  await rm(join(dir, "tests/modules/entity-validation.test.ts"), {
    force: true,
  });
  await rm(join(dir, "tests/modules/expand.test.ts"), { force: true });
  await rm(join(dir, "tests/modules/field-privacy.test.ts"), { force: true });
  await rm(join(dir, "tests/modules/meta.test.ts"), { force: true });
  await rm(join(dir, "tests/modules/query-engine.test.ts"), { force: true });
  await rm(join(dir, "tests/modules/repository.test.ts"), { force: true });
  await rm(join(dir, "tests/modules/service.test.ts"), { force: true });
  await rm(join(dir, "tests/helpers/crud-test-base.ts"), { force: true });
  await rm(join(dir, "tests/helpers/crud-test-base.test.ts"), { force: true });
  await rm(join(dir, "tests/helpers/migration-checksum.ts"), { force: true });
  await rm(join(dir, "tests/helpers/migration-checksum.test.ts"), {
    force: true,
  });

  const pkgPath = join(dir, "package.json");
  const pkg = await readJsonObject(pkgPath);
  retargetPackageForDrizzle(pkg);
  await writeJsonObject(pkgPath, pkg);

  await mkdir(join(dir, "src/db"), { recursive: true });
  await writeFile(join(dir, "src/db/client.ts"), drizzleClientSource());
  await writeFile(join(dir, "src/db/schema.ts"), drizzleSchemaSource());
  await writeFile(join(dir, "drizzle.config.ts"), drizzleConfigSource());
  await writeFile(join(dir, "src/app.ts"), drizzleFastifyAppSource());
  await writeDrizzleFastifyTests(dir);
  await writeFile(join(dir, "Dockerfile"), drizzleNodeDockerfileSource(vars));
}

async function applyDrizzleExpress(
  dir: string,
  vars: GeneratorVars,
): Promise<void> {
  await rm(join(dir, "prisma"), { recursive: true, force: true });
  await rm(join(dir, "src/prisma.ts"), { force: true });
  await rm(join(dir, "src/modules/_base"), { recursive: true, force: true });
  await rm(join(dir, "src/modules/audit-logs"), {
    recursive: true,
    force: true,
  });
  await rm(join(dir, "tests/modules/auto-routes.test.ts"), { force: true });
  await rm(join(dir, "tests/helpers/crud-test-base.ts"), { force: true });
  await rm(join(dir, "tests/helpers/migration-checksum.ts"), { force: true });
  await rm(join(dir, "tests/global-setup.ts"), { force: true });

  const pkgPath = join(dir, "package.json");
  const pkg = await readJsonObject(pkgPath);
  retargetPackageForDrizzle(pkg);
  await writeJsonObject(pkgPath, pkg);

  await mkdir(join(dir, "src/db"), { recursive: true });
  await writeFile(join(dir, "src/db/client.ts"), drizzleClientSource());
  await writeFile(join(dir, "src/db/schema.ts"), drizzleSchemaSource());
  await writeFile(join(dir, "drizzle.config.ts"), drizzleConfigSource());
  await writeFile(join(dir, "src/app.ts"), drizzleExpressAppSource());
  await writeFile(join(dir, "src/server.ts"), drizzleExpressServerSource());
  await writeDrizzleExpressTests(dir);
  await writeFile(join(dir, "Dockerfile"), drizzleNodeDockerfileSource(vars));
}

async function writeDrizzleFastifyTests(dir: string): Promise<void> {
  await rm(join(dir, "tests"), { recursive: true, force: true });
  await mkdir(join(dir, "tests/modules"), { recursive: true });
  await writeFile(
    join(dir, "tests/modules/app.test.ts"),
    `import { describe, expect, it, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

describe('Fastify Drizzle app', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('exposes empty generated metadata until entities are added', async () => {
    app = await buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/v1/_meta' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ entities: [], orm: 'drizzle' });
  });
});
`,
  );
  await writeFile(
    join(dir, "vitest.config.ts"),
    `import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config({ path: '.env.test' });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/app.ts', 'src/config.ts', 'src/plugins/swagger.ts'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    pool: 'forks',
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
`,
  );
}

async function writeDrizzleExpressTests(dir: string): Promise<void> {
  await rm(join(dir, "tests"), { recursive: true, force: true });
  await mkdir(join(dir, "tests"), { recursive: true });
  await writeFile(
    join(dir, "tests/app.test.ts"),
    `import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('Express Drizzle app', () => {
  it('exposes empty generated metadata until entities are added', async () => {
    const res = await request(buildApp()).get('/api/v1/_meta');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entities: [], orm: 'drizzle' });
  });

  it('returns structured errors with request id', async () => {
    const res = await request(buildApp()).get('/missing').set('x-request-id', 'req-missing');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({
      code: 'not_found',
      request_id: 'req-missing',
    });
  });
});
`,
  );
  await writeFile(
    join(dir, "vitest.config.ts"),
    `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/config.ts'],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
`,
  );
}

function drizzleClientSource(): string {
  return `import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config.js';
import * as schema from './schema.js';

export const pool = new Pool({ connectionString: config.DATABASE_URL });
export const db = drizzle(pool, { schema });

export async function checkDatabase(): Promise<void> {
  await pool.query('SELECT 1');
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export type DbClient = typeof db;
`;
}

function drizzleSchemaSource(): string {
  return `import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  action: text('action').notNull(),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  performedBy: text('performed_by').notNull().default('system'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
`;
}

function drizzleConfigSource(): string {
  return `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
`;
}

function drizzleFastifyAppSource(): string {
  return `import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import errorHandler from './plugins/error-handler.js';
import authPlugin from './plugins/auth.js';
import authzPlugin from './plugins/authz.js';
import requestIdPlugin from './plugins/request-id.js';
import swaggerPlugin from './plugins/swagger.js';
import { checkDatabase, closeDatabase, db } from './db/client.js';

export interface BuildAppOptions {
  logger?: boolean | object;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? {
      level: config.LOG_LEVEL,
      transport:
        process.env.NODE_ENV !== 'production'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
            }
          : undefined,
    },
    genReqId: (req) => (req.headers['x-request-id'] as string) || crypto.randomUUID(),
  });

  app.decorate('db', db);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ALLOW_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    keyGenerator: (request: FastifyRequest) => request.authUser?.sub ?? request.ip,
  });

  await app.register(swaggerPlugin);
  await app.register(errorHandler);
  await app.register(requestIdPlugin);
  await app.register(authPlugin);
  await app.register(authzPlugin);

  app.get(
    '/api/health',
    {
      config: { public: true },
      schema: {
        tags: ['health'],
      },
    },
    async (_request, reply) => {
      const checks: Record<string, string> = { app: 'ok' };
      try {
        await checkDatabase();
        checks.database = 'ok';
      } catch (e) {
        checks.database = \`error: \${e instanceof Error ? e.message : String(e)}\`;
        return reply.status(503).send({ status: 'unhealthy', checks });
      }
      return reply.send({ status: 'healthy', checks });
    },
  );

  app.get(
    '/api/v1/_meta',
    {
      config: { public: true },
      schema: { tags: ['meta'] },
    },
    async () => ({ entities: [], orm: 'drizzle' }),
  );

  app.addHook('onClose', async () => {
    await closeDatabase();
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: typeof db;
  }
}
`;
}

function drizzleExpressAppSource(): string {
  return `import crypto from 'node:crypto';
import compression from 'compression';
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { allowedOrigins, config } from './config.js';
import { ApiError, errorHandler, notFoundHandler } from './errors.js';
import { checkDatabase, db } from './db/client.js';

const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const value = typeof incoming === 'string' && incoming.trim() ? incoming : crypto.randomUUID();
  res.locals.requestId = value;
  res.setHeader('x-request-id', value);
  next();
};

function corsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  const origins = allowedOrigins();
  if (!origin || origins.includes('*') || origins.includes(origin)) {
    callback(null, true);
    return;
  }
  callback(new ApiError(403, 'Origin not allowed', 'origin_not_allowed'));
}

export function buildApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.locals.db = db;
  app.use(requestId);
  app.use(
    pinoHttp({
      level: config.LOG_LEVEL,
      enabled: config.NODE_ENV !== 'test',
      quietReqLogger: config.NODE_ENV === 'test',
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.RATE_LIMIT_MAX,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );

  app.get('/api/health', async (_req, res) => {
    const checks: Record<string, string> = { app: 'ok' };
    try {
      await checkDatabase();
      checks.database = 'ok';
    } catch (e) {
      checks.database = \`error: \${e instanceof Error ? e.message : String(e)}\`;
      res.status(503).json({ status: 'unhealthy', checks });
      return;
    }
    res.json({ status: 'healthy', checks });
  });

  app.get('/api/v1/_meta', (_req, res) => {
    res.json({ entities: [], orm: 'drizzle' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
`;
}

function drizzleExpressServerSource(): string {
  return `import { createServer } from 'node:http';
import { buildApp } from './app.js';
import { config } from './config.js';
import { closeDatabase } from './db/client.js';

const app = buildApp();
const server = createServer(app);

server.listen(config.PORT, config.HOST, () => {
  console.log(\`Express API listening on http://\${config.HOST}:\${config.PORT}\`);
});

function shutdown(signal: string): void {
  console.log(\`\${signal} received, closing HTTP server\`);
  server.close((err) => {
    closeDatabase()
      .catch((closeErr: unknown) => {
        console.error(closeErr);
      })
      .finally(() => {
        if (err) {
          console.error(err);
          process.exit(1);
        }
        process.exit(0);
      });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
`;
}

function drizzleNodeDockerfileSource(vars: GeneratorVars): string {
  const pm = vars.pm as {
    name?: string;
    ci?: string;
    exec?: string;
    run?: string;
    lockfile?: string;
  };
  const pmName = pm.name ?? "npm";
  const lockfile = pm.lockfile ?? "package-lock.json";
  const install = pm.ci ?? "npm ci";
  const exec = pm.exec ?? "npx";
  const run = pm.run ?? "npm run";
  const setup =
    pmName === "pnpm"
      ? `ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
`
      : pmName === "yarn"
        ? "RUN corepack enable\n"
        : pmName === "bun"
          ? "RUN npm install -g bun\n"
          : "";
  return `FROM node:22-bookworm-slim AS base

RUN apt-get update \\
    && apt-get install -y --no-install-recommends ca-certificates \\
    && rm -rf /var/lib/apt/lists/*

${setup}\
WORKDIR /app

FROM base AS deps
COPY package.json ${lockfile} ./
RUN ${install}

FROM base AS build
ENV NODE_OPTIONS="--max-old-space-size=768"
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json drizzle.config.ts ./
COPY src ./src
RUN ${run} build

FROM build AS migrate
CMD ["sh", "-c", "${exec} drizzle-kit push --force"]

FROM base AS runtime
ENV NODE_ENV=production
RUN npm install -g pm2@5.4.3
RUN chown -R node /app
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ecosystem.config.cjs* ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \\
    CMD ["node", "-e", "require('http').get('http://localhost:3000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]

CMD ["sh", "-c", "if [ -f ecosystem.config.cjs ]; then pm2-runtime ecosystem.config.cjs; else node dist/server.js; fi"]
`;
}

async function substituteNamesForInstance(
  inst: ComponentInstance,
  dest: string,
  name: string,
  nameSnake: string,
  overrides?: Partial<Record<Component, string>>,
): Promise<void> {
  const { type, path } = inst;
  const isCanonical = path === type;
  if (type === "fastapi") {
    const target = isCanonical
      ? (overrides?.fastapi ?? `${name}-fastapi`)
      : `${name}-${path}`;
    await replaceInFile(
      join(dest, `${path}/pyproject.toml`),
      "projx-fastapi",
      target,
    );
  } else if (type === "fastify") {
    const target = isCanonical
      ? (overrides?.fastify ?? `${name}-fastify`)
      : `${name}-${path}`;
    await replaceInFile(
      join(dest, `${path}/package.json`),
      "projx-fastify",
      target,
    );
  } else if (type === "express") {
    const target = isCanonical
      ? (overrides?.express ?? `${name}-express`)
      : `${name}-${path}`;
    await replaceInFile(
      join(dest, `${path}/package.json`),
      "projx-express",
      target,
    );
  } else if (type === "frontend") {
    const target = isCanonical
      ? (overrides?.frontend ?? `${name}-frontend`)
      : `${name}-${path}`;
    await replaceInFile(
      join(dest, `${path}/package.json`),
      "projx-frontend",
      target,
    );
  } else if (type === "e2e") {
    const target = isCanonical
      ? (overrides?.e2e ?? `${name}-e2e`)
      : `${name}-${path}`;
    await replaceInFile(
      join(dest, `${path}/package.json`),
      "projx-e2e",
      target,
    );
  } else if (type === "mobile") {
    const target = isCanonical
      ? (overrides?.mobile ?? `${nameSnake}_mobile`)
      : toSnake(`${nameSnake}_${path}`);
    await replaceInFile(
      join(dest, `${path}/pubspec.yaml`),
      "projx_mobile",
      target,
    );
    await replaceInDir(
      join(dest, path),
      "package:projx_mobile/",
      `package:${target}/`,
      ".dart",
    );
  }
}

export async function detectPackageNameOverrides(
  cwd: string,
  components: Component[],
  componentPaths: ComponentPaths,
): Promise<Partial<Record<Component, string>>> {
  const overrides: Partial<Record<Component, string>> = {};

  if (components.includes("fastapi")) {
    const file = join(cwd, componentPaths.fastapi, "pyproject.toml");
    const name = await readTomlProjectName(file);
    if (name) overrides.fastapi = name;
  }
  for (const c of ["fastify", "express", "frontend", "e2e"] as const) {
    if (!components.includes(c)) continue;
    const file = join(cwd, componentPaths[c], "package.json");
    const name = await readJsonName(file);
    if (name) overrides[c] = name;
  }
  if (components.includes("mobile")) {
    const file = join(cwd, componentPaths.mobile, "pubspec.yaml");
    const name = await readPubspecName(file);
    if (name) overrides.mobile = name;
  }

  return overrides;
}

async function readTomlProjectName(file: string): Promise<string | null> {
  if (!existsSync(file)) return null;
  try {
    const content = await readFile(file, "utf-8");
    const match = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function readJsonName(file: string): Promise<string | null> {
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(await readFile(file, "utf-8"));
    return typeof data.name === "string" ? data.name : null;
  } catch {
    return null;
  }
}

async function readPubspecName(file: string): Promise<string | null> {
  if (!existsSync(file)) return null;
  try {
    const content = await readFile(file, "utf-8");
    const match = content.match(/^\s*name\s*:\s*([A-Za-z0-9_]+)/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

// --- Main entry point ---

export async function applyTemplate(
  cwd: string,
  repoDir: string,
  components: Component[],
  componentPaths: ComponentPaths,
  vars: GeneratorVars,
  version: string,
  componentSkips?: Record<string, string[]>,
  rootSkip?: string[],
  applyDefaults = false,
  extraInstances: ComponentInstance[] = [],
  instancesToScaffold?: ComponentInstance[],
): Promise<MergeResult> {
  const hasHead = (() => {
    try {
      execSync("git rev-parse HEAD", { cwd, stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  })();

  if (!hasHead) {
    await writeTemplateToDir(
      cwd,
      repoDir,
      components,
      componentPaths,
      vars,
      version,
      {
        componentSkips,
        rootSkip,
        applyDefaults,
        realCwd: cwd,
        extraInstances,
        instancesToScaffold,
      },
    );
    return { status: "clean" };
  }

  // --- Write template into orphan worktree ---
  const { worktree, branch } = createOrphanWorktree(cwd);

  try {
    await writeTemplateToDir(
      worktree,
      repoDir,
      components,
      componentPaths,
      vars,
      version,
      {
        componentSkips,
        rootSkip,
        applyDefaults,
        realCwd: cwd,
        extraInstances,
        instancesToScaffold,
      },
    );

    execSync("git add -A", { cwd: worktree, stdio: "pipe" });

    const diff = execSync("git diff --cached --stat", {
      cwd: worktree,
      stdio: "pipe",
    })
      .toString()
      .trim();
    if (!diff) {
      cleanupWorktree(cwd, worktree, branch);
      return { status: "clean" };
    }

    execSync(
      `git -c core.hooksPath=/dev/null commit -m "projx: template v${version} [${components.join(", ")}]"`,
      { cwd: worktree, stdio: "pipe" },
    );

    // Remove worktree but keep branch for merging
    try {
      execSync(`git worktree remove "${worktree}" --force`, {
        cwd,
        stdio: "pipe",
      });
    } catch {
      try {
        await rm(worktree, { recursive: true, force: true });
        execSync("git worktree prune", { cwd, stdio: "pipe" });
      } catch {
        // best effort
      }
    }

    // --- Tier 1: Git merge via orphan branch ---
    let mergeClean = false;
    try {
      execSync(
        `git merge ${branch} --allow-unrelated-histories -m "projx: update to template v${version}"`,
        { cwd, stdio: "pipe" },
      );
      mergeClean = true;
    } catch {
      try {
        execSync("git merge --abort", { cwd, stdio: "pipe" });
      } catch {
        // may not be in merge state
      }
    }

    // Delete temp branch
    try {
      execSync(`git branch -D ${branch}`, { cwd, stdio: "pipe" });
    } catch {
      // non-critical
    }

    if (mergeClean) {
      await migrateComponentMarkers(
        cwd,
        components,
        componentPaths,
        applyDefaults,
      );
      saveBaselineRef(cwd);
      return { status: "clean" };
    }

    // --- Tier 2: Per-file 3-way merge using baseline ref ---
    const baselineRef = getBaselineRef(cwd);
    if (baselineRef) {
      const tmpTemplate = await mkdtemp(join(tmpdir(), "projx-tpl-"));
      await writeTemplateToDir(
        tmpTemplate,
        repoDir,
        components,
        componentPaths,
        vars,
        version,
        {
          componentSkips,
          rootSkip,
          applyDefaults,
          realCwd: cwd,
          extraInstances,
          instancesToScaffold,
        },
      );

      const result = await tryThreeWayMerge(
        cwd,
        tmpTemplate,
        baselineRef,
        componentPaths,
      );
      await rm(tmpTemplate, { recursive: true, force: true });

      await migrateComponentMarkers(
        cwd,
        components,
        componentPaths,
        applyDefaults,
      );

      if (result.conflicted.length === 0) {
        await writeManagedProjx(cwd, version, vars, applyDefaults);
        execSync("git add -A", { cwd, stdio: "pipe" });
        const staged = execSync("git diff --cached --stat", {
          cwd,
          stdio: "pipe",
        })
          .toString()
          .trim();
        if (staged) {
          execSync(
            `git -c core.hooksPath=/dev/null commit -m "projx: update to template v${version} (3-way merge)"`,
            { cwd, stdio: "pipe" },
          );
        }
        saveBaselineRef(cwd);
        return result.merged.length > 0
          ? { status: "merged", mergedFiles: result.merged }
          : { status: "clean" };
      }

      await writeManagedProjx(cwd, version, vars, applyDefaults);

      for (const f of result.merged) {
        try {
          execSync(`git add "${f}"`, { cwd, stdio: "pipe" });
        } catch {
          // best effort
        }
      }
      execSync("git add .projx", { cwd, stdio: "pipe" });
      for (const component of components) {
        const dir = componentPaths[component];
        const markerRel = `${dir}/.projx-component`;
        if (existsSync(join(cwd, markerRel))) {
          try {
            execSync(`git add "${markerRel}"`, { cwd, stdio: "pipe" });
          } catch {
            // best effort
          }
        }
      }

      return {
        status: "conflicts",
        mergedFiles: result.merged,
        conflictedFiles: result.conflicted,
      };
    }

    // --- Tier 3: Direct copy (no baseline available) ---
    await writeTemplateToDir(
      cwd,
      repoDir,
      components,
      componentPaths,
      vars,
      version,
      {
        componentSkips,
        rootSkip,
        applyDefaults,
        realCwd: cwd,
        extraInstances,
        instancesToScaffold,
      },
    );
    await migrateComponentMarkers(
      cwd,
      components,
      componentPaths,
      applyDefaults,
    );
    return { status: "conflicts" };
  } catch (err) {
    cleanupWorktree(cwd, worktree, branch);
    throw err;
  }
}
