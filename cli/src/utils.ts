import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const REPO = "ukanhaupa/projx";
export const REPO_URL = `https://github.com/${REPO}`;

export const COMPONENTS = [
  "fastapi",
  "fastify",
  "frontend",
  "mobile",
  "e2e",
  "infra",
] as const;

export type Component = (typeof COMPONENTS)[number];

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export interface PmCommands {
  name: PackageManager;
  install: string;
  ci: string;
  run: string;
  exec: string;
  dlx: string;
  lockfile: string;
  prismaExec: string;
  runDev: string;
  audit: string;
}

export function pmCommands(pm: PackageManager): PmCommands {
  switch (pm) {
    case "npm":
      return {
        name: "npm",
        install: "npm install",
        ci: "npm ci",
        run: "npm run",
        exec: "npx",
        dlx: "npx",
        lockfile: "package-lock.json",
        prismaExec: "npx prisma",
        runDev: "npm run dev",
        audit: "npm audit --omit=dev",
      };
    case "pnpm":
      return {
        name: "pnpm",
        install: "pnpm install",
        ci: "pnpm install --frozen-lockfile",
        run: "pnpm",
        exec: "pnpm exec",
        dlx: "pnpm dlx",
        lockfile: "pnpm-lock.yaml",
        prismaExec: "pnpm prisma",
        runDev: "pnpm dev",
        audit: "pnpm audit --prod",
      };
    case "yarn":
      return {
        name: "yarn",
        install: "yarn",
        ci: "yarn --frozen-lockfile",
        run: "yarn",
        exec: "yarn",
        dlx: "yarn dlx",
        lockfile: "yarn.lock",
        prismaExec: "yarn prisma",
        runDev: "yarn dev",
        audit: "yarn npm audit --environment production",
      };
    case "bun":
      return {
        name: "bun",
        install: "bun install",
        ci: "bun install --frozen-lockfile",
        run: "bun run",
        exec: "bunx",
        dlx: "bunx",
        lockfile: "bun.lockb",
        prismaExec: "bunx prisma",
        runDev: "bun run dev",
        audit: "bun audit --prod",
      };
  }
}

export function detectPackageManager(cwd: string): PackageManager | null {
  if (existsSync(join(cwd, "bun.lockb"))) return "bun";
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  return null;
}

export function detectPackageManagerFromComponents(
  cwd: string,
  componentPaths: Partial<Record<Component, string>>,
): PackageManager | null {
  const jsComponents: Component[] = ["fastify", "frontend", "e2e"];
  for (const component of jsComponents) {
    const dir = componentPaths[component];
    if (!dir) continue;
    const fullDir = join(cwd, dir);
    if (!existsSync(fullDir)) continue;
    const detected = detectPackageManager(fullDir);
    if (detected) return detected;
  }
  return detectPackageManager(cwd);
}

export interface Options {
  name: string;
  components: Component[];
  git: boolean;
  install: boolean;
  packageManager?: PackageManager;
}

export function toKebab(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

export function toSnake(s: string): string {
  return toKebab(s).replace(/-/g, "_");
}

export function toTitle(s: string): string {
  return s
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function hasCommand(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function exec(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: "pipe" });
}

export function sharedTemplateDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(thisFile, "../../src/templates");
}

export async function downloadRepo(localPath?: string): Promise<string> {
  if (localPath) {
    return localPath;
  }

  const dest = join(tmpdir(), `projx-${Date.now()}`);
  await mkdir(dest, { recursive: true });

  if (hasCommand("git")) {
    execSync(`git clone --depth 1 ${REPO_URL}.git "${dest}/repo"`, {
      stdio: "pipe",
    });
    return join(dest, "repo");
  }

  const tarUrl = `${REPO_URL}/archive/refs/heads/main.tar.gz`;
  execSync(`curl -sL "${tarUrl}" | tar xz -C "${dest}"`, { stdio: "pipe" });

  const entries = await readdir(dest);
  const extracted = entries.find((e: string) => e.startsWith("projx-"));
  if (!extracted) throw new Error("Failed to extract repo archive.");
  return join(dest, extracted);
}

export async function cleanupRepo(
  repoDir: string,
  isLocal: boolean,
): Promise<void> {
  if (isLocal) return;
  const parent = resolve(repoDir, "..");
  if (parent.startsWith(tmpdir())) {
    await rm(parent, { recursive: true, force: true });
  }
}

export const EXCLUDE = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "__pycache__",
  ".dart_tool",
  ".flutter-plugins",
  ".flutter-plugins-dependencies",
  ".venv",
  ".pytest_cache",
  ".ruff_cache",
  ".mypy_cache",
  "playwright-report",
  "test-results",
  ".terraform",
  "cli",
]);

const EXCLUDE_FILES = new Set([
  "uv.lock",
  "pnpm-lock.yaml",
  "package-lock.json",
  "pubspec.lock",
  ".env",
  ".env.dev",
  ".env.staging",
  ".env.prod",
  "dev.tfplan",
  ".coverage",
]);

export async function copyComponent(
  repoDir: string,
  component: string,
  dest: string,
): Promise<string[]> {
  const src = join(repoDir, component);
  const out = join(dest, component);
  const files: string[] = [];

  await cp(src, out, {
    recursive: true,
    filter: (source: string) => {
      const base = source.split("/").pop()!;
      if (EXCLUDE.has(base)) return false;
      if (EXCLUDE_FILES.has(base)) return false;
      if (base.endsWith(".pyc")) return false;
      return true;
    },
  });

  await collectFiles(out, out, files);
  return files;
}

export async function copyStaticFiles(
  repoDir: string,
  dest: string,
): Promise<string[]> {
  const manifest: string[] = [];
  const tpl = repoDir;

  const statics = [".editorconfig"];
  for (const file of statics) {
    const src = join(tpl, file);
    if (existsSync(src)) {
      await cp(src, join(dest, file));
      manifest.push(file);
    }
  }

  const extensionsJson = join(tpl, ".vscode/extensions.json");
  if (existsSync(extensionsJson)) {
    await mkdir(join(dest, ".vscode"), { recursive: true });
    await cp(extensionsJson, join(dest, ".vscode/extensions.json"));
    manifest.push(".vscode/extensions.json");
  }

  const staticScripts = ["setup-docker.sh", "setup-ssl.sh"];
  const scriptsSrc = join(tpl, "scripts");
  if (existsSync(scriptsSrc)) {
    await mkdir(join(dest, "scripts"), { recursive: true });
    for (const file of staticScripts) {
      const src = join(scriptsSrc, file);
      const dst = join(dest, "scripts", file);
      if (existsSync(src) && !existsSync(dst)) {
        await cp(src, dst);
        await chmod(dst, 0o755);
        manifest.push(`scripts/${file}`);
      }
    }
  }

  return manifest;
}

async function collectFiles(
  dir: string,
  root: string,
  files: string[],
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(full, root, files);
    } else {
      files.push(full.slice(root.length + 1));
    }
  }
}

export async function replaceInFile(
  filePath: string,
  find: string,
  replace: string,
): Promise<void> {
  if (!existsSync(filePath)) return;
  const content = await readFile(filePath, "utf-8");
  if (!content.includes(find)) return;
  await writeFile(filePath, content.replaceAll(find, replace));
}

export async function replaceInDir(
  dir: string,
  find: string,
  replace: string,
  ext: string,
): Promise<void> {
  if (!existsSync(dir)) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await replaceInDir(full, find, replace, ext);
    } else if (entry.name.endsWith(ext)) {
      await replaceInFile(full, find, replace);
    }
  }
}

export const COMPONENT_MARKER = ".projx-component";

export async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

export type ComponentPaths = Record<Component, string>;

export interface ComponentInstance {
  type: Component;
  path: string;
}

export interface ComponentMarkerData {
  component: Component;
  skip: string[];
}

function parseMarker(raw: string): ComponentMarkerData | null {
  try {
    const data = JSON.parse(raw);
    let component: Component | undefined;
    if (
      typeof data.component === "string" &&
      COMPONENTS.includes(data.component as Component)
    ) {
      component = data.component as Component;
    } else if (Array.isArray(data.components) && data.components.length > 0) {
      const first = data.components[0];
      if (
        typeof first === "string" &&
        COMPONENTS.includes(first as Component)
      ) {
        component = first as Component;
      }
    }
    if (!component) return null;
    return {
      component,
      skip: Array.isArray(data.skip) ? data.skip : [],
    };
  } catch {
    return null;
  }
}

export async function readComponentMarker(
  dir: string,
): Promise<ComponentMarkerData | null> {
  const raw = await readFileOrNull(join(dir, COMPONENT_MARKER));
  if (!raw) return null;
  return parseMarker(raw);
}

export async function writeComponentMarker(
  dir: string,
  data: ComponentMarkerData,
): Promise<void> {
  const markerPath = join(dir, COMPONENT_MARKER);
  const out: ComponentMarkerData = {
    component: data.component,
    skip: Array.isArray(data.skip) ? data.skip : [],
  };
  await writeFile(markerPath, JSON.stringify(out, null, 2) + "\n");
}

export async function upsertComponentMarker(
  dir: string,
  component: Component,
  skip?: string[],
): Promise<void> {
  const existing = await readComponentMarker(dir);
  await writeComponentMarker(dir, {
    component,
    skip: skip ?? existing?.skip ?? [],
  });
}

export async function readProjxConfig(
  cwd: string,
): Promise<Record<string, unknown>> {
  const path = join(cwd, ".projx");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return {};
  }
}

export async function writeProjxConfig(
  cwd: string,
  data: Record<string, unknown>,
): Promise<void> {
  const path = join(cwd, ".projx");
  const today = new Date().toISOString().split("T")[0];
  const out: Record<string, unknown> = { ...data };
  if (typeof out.createdAt !== "string") out.createdAt = today;
  if (!Array.isArray(out.skip)) out.skip = [];
  await writeFile(path, JSON.stringify(out, null, 2) + "\n");
}

export const DEFAULT_ROOT_SKIP_PATTERNS: string[] = [
  "docker-compose.yml",
  "docker-compose.dev.yml",
  "README.md",
  ".githooks/pre-commit",
  ".github/workflows/ci.yml",
  "scripts/setup.sh",
  "scripts/setup-docker.sh",
  "scripts/setup-ssl.sh",
];

export const DEFAULT_COMPONENT_SKIP_PATTERNS: Partial<
  Record<Component, string[]>
> = {
  fastapi: ["pyproject.toml"],
  fastify: ["package.json"],
  frontend: ["package.json"],
  e2e: ["package.json"],
  mobile: ["pubspec.yaml"],
};

export async function discoverComponentPaths(
  cwd: string,
  components: Component[],
): Promise<ComponentPaths> {
  const { paths: discovered } = await discoverComponentsFromMarkers(cwd);
  const paths: Partial<ComponentPaths> = { ...discovered };
  for (const c of components) {
    if (!paths[c]) paths[c] = c;
  }
  return paths as ComponentPaths;
}

export async function discoverComponentsFromMarkers(cwd: string): Promise<{
  components: Component[];
  paths: ComponentPaths;
  instances: ComponentInstance[];
}> {
  const components: Component[] = [];
  const paths: Partial<ComponentPaths> = {};
  const instances: ComponentInstance[] = [];

  if (!existsSync(cwd))
    return { components, paths: paths as ComponentPaths, instances };

  const entries = await readdir(cwd, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (EXCLUDE.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;

    const marker = await readComponentMarker(join(cwd, entry.name));
    if (!marker) continue;
    instances.push({ type: marker.component, path: entry.name });
    if (!components.includes(marker.component)) {
      components.push(marker.component);
      paths[marker.component] = entry.name;
    }
  }

  for (const c of components) {
    if (!paths[c]) paths[c] = c;
  }

  return { components, paths: paths as ComponentPaths, instances };
}

export function render(
  template: string,
  vars: Record<string, unknown>,
): string {
  const lines = template.split("\n");
  return renderLines(lines, vars).replace(/\n{3,}/g, "\n\n");
}

function evalExpr(expr: string, vars: Record<string, unknown>): unknown {
  const components = vars.components as string[];
  const projectName = vars.projectName as string;
  const pmName = (vars.pm as { name?: string })?.name ?? "npm";
  const argNames = ["components", "projectName", "pm"];
  const argValues: unknown[] = [components, projectName, pmName];
  for (const [k, v] of Object.entries(vars)) {
    if (k === "components" || k === "projectName" || k === "pm") continue;
    if (!/^[a-zA-Z_$][\w$]*$/.test(k)) continue;
    argNames.push(k);
    argValues.push(v);
  }
  const fn = new Function(...argNames, `return ${expr}`);
  return fn(...argValues);
}

function findBlockEnd(lines: string[], startIdx: number): number {
  let depth = 1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^<%\s*(if|for)\s*\(.+?\)\s*\{?\s*%>$/.test(line)) depth++;
    else if (/^<%\s*\}\s*else\s+if\s*\((.+?)\)\s*\{?\s*%>$/.test(line)) {
      // else-if doesn't change depth
    } else if (/^<%\s*\}\s*else\s*\{?\s*%>$/.test(line)) {
      // else doesn't change depth
    } else if (/^<%\s*\}?\s*%>$/.test(line)) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("Unmatched template block");
}

function renderLines(lines: string[], vars: Record<string, unknown>): string {
  const output: string[] = [];
  const stack: { active: boolean; matched: boolean }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const forMatch = line.match(
      /^<%\s*for\s*\(\s*(?:const|let)\s+(\w+)\s+of\s+(.+?)\s*\)\s*\{?\s*%>$/,
    );
    if (forMatch) {
      const varName = forMatch[1];
      const iterExpr = forMatch[2];
      const end = findBlockEnd(lines, i);
      const bodyLines = lines.slice(i + 1, end);
      if (stack.length === 0 || stack.every((v) => v.active)) {
        const iterable = evalExpr(iterExpr, vars) as unknown[];
        if (Array.isArray(iterable)) {
          for (const item of iterable) {
            const sub = renderLines(bodyLines, { ...vars, [varName]: item });
            if (sub) output.push(sub);
          }
        }
      }
      i = end;
      continue;
    }

    const ifMatch = line.match(/^<%\s*if\s*\((.+?)\)\s*\{?\s*%>$/);
    if (ifMatch) {
      const result = Boolean(evalExpr(ifMatch[1], vars));
      stack.push({ active: result, matched: result });
      continue;
    }

    const elseIfMatch = line.match(
      /^<%\s*\}\s*else\s+if\s*\((.+?)\)\s*\{?\s*%>$/,
    );
    if (elseIfMatch) {
      if (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.matched) {
          top.active = false;
        } else {
          const result = Boolean(evalExpr(elseIfMatch[1], vars));
          top.active = result;
          if (result) top.matched = true;
        }
      }
      continue;
    }

    if (/^<%\s*\}\s*else\s*\{?\s*%>$/.test(line)) {
      if (stack.length > 0) {
        const top = stack[stack.length - 1];
        top.active = !top.matched;
      }
      continue;
    }

    if (/^<%\s*\}?\s*%>$/.test(line)) {
      stack.pop();
      continue;
    }

    if (stack.length > 0 && stack.some((v) => !v.active)) continue;

    const replaced = line.replace(/<%=\s*(.+?)\s*%>/g, (_, expr: string) => {
      const trimmed = expr.trim();
      if (/^[\w.]+$/.test(trimmed)) {
        const parts = trimmed.split(".");
        let val: unknown = vars;
        for (const p of parts) {
          val = (val as Record<string, unknown>)?.[p];
        }
        return String(val ?? "");
      }
      const val = evalExpr(trimmed, vars);
      return String(val ?? "");
    });
    output.push(replaced);
  }

  return output.join("\n");
}

export async function renderEjsInDir(
  dir: string,
  vars: Record<string, unknown>,
): Promise<void> {
  if (!existsSync(dir)) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await renderEjsInDir(full, vars);
    } else if (entry.name.endsWith(".ejs")) {
      const content = await readFile(full, "utf-8");
      const rendered = render(content, vars);
      const out = full.slice(0, -".ejs".length);
      await writeFile(out, rendered);
      await rm(full);
    }
  }
}

export function detectProjectName(
  cwd: string,
  components: Component[],
  componentPaths: ComponentPaths,
): string {
  for (const component of components) {
    const dir = componentPaths[component] ?? component;
    const pkgPath = join(cwd, dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const n = pkg.name as string;
        if (n && n.includes("-")) {
          return n.substring(0, n.lastIndexOf("-"));
        }
      } catch {
        // continue
      }
    }
  }
  return toKebab(cwd.split("/").pop()!);
}
