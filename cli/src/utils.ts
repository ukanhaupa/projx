import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
}

export function pmCommands(pm: PackageManager): PmCommands {
  switch (pm) {
    case "npm":
      return { name: "npm", install: "npm install", ci: "npm ci", run: "npm run", exec: "npx", dlx: "npx", lockfile: "package-lock.json", prismaExec: "npx prisma", runDev: "npm run dev" };
    case "pnpm":
      return { name: "pnpm", install: "pnpm install", ci: "pnpm install --frozen-lockfile", run: "pnpm", exec: "pnpm exec", dlx: "pnpm dlx", lockfile: "pnpm-lock.yaml", prismaExec: "pnpm prisma", runDev: "pnpm dev" };
    case "yarn":
      return { name: "yarn", install: "yarn", ci: "yarn --frozen-lockfile", run: "yarn", exec: "yarn", dlx: "yarn dlx", lockfile: "yarn.lock", prismaExec: "yarn prisma", runDev: "yarn dev" };
    case "bun":
      return { name: "bun", install: "bun install", ci: "bun install --frozen-lockfile", run: "bun run", exec: "bunx", dlx: "bunx", lockfile: "bun.lockb", prismaExec: "bunx prisma", runDev: "bun run dev" };
  }
}

export function detectPackageManager(cwd: string): PackageManager | null {
  if (existsSync(join(cwd, "bun.lockb"))) return "bun";
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  return null;
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
    execSync(
      `git clone --depth 1 ${REPO_URL}.git "${dest}/repo"`,
      { stdio: "pipe" },
    );
    return join(dest, "repo");
  }

  const tarUrl = `${REPO_URL}/archive/refs/heads/main.tar.gz`;
  execSync(
    `curl -sL "${tarUrl}" | tar xz -C "${dest}"`,
    { stdio: "pipe" },
  );

  const entries = await readdir(dest);
  const extracted = entries.find((e: string) => e.startsWith("projx-"));
  if (!extracted) throw new Error("Failed to extract repo archive.");
  return join(dest, extracted);
}

export async function cleanupRepo(repoDir: string, isLocal: boolean): Promise<void> {
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

  const scripts = join(tpl, "scripts");
  if (existsSync(scripts)) {
    await cp(scripts, join(dest, "scripts"), { recursive: true });
    manifest.push("scripts/setup-ssl.sh");
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

export type ComponentOrigin = "scaffold" | "init";

export interface ComponentMarkerData {
  components: string[];
  origin?: ComponentOrigin;
  skip?: string[];
}

export async function readComponentMarker(dir: string): Promise<ComponentMarkerData | null> {
  const raw = await readFileOrNull(join(dir, COMPONENT_MARKER));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return {
      components: data.components ?? (data.component ? [data.component] : []),
      origin: data.origin,
      skip: data.skip,
    };
  } catch {
    return null;
  }
}

export async function writeComponentMarker(
  dir: string,
  component: Component,
  origin: ComponentOrigin = "scaffold",
  skip?: string[],
): Promise<void> {
  const markerPath = join(dir, COMPONENT_MARKER);
  let components: string[] = [component];
  let existingOrigin: ComponentOrigin = origin;
  let existingSkip: string[] | undefined = skip;

  const existing = await readFileOrNull(markerPath);
  if (existing) {
    try {
      const data = JSON.parse(existing);
      const prev: string[] = data.components ?? (data.component ? [data.component] : []);
      existingOrigin = origin ?? data.origin ?? "scaffold";
      existingSkip = skip ?? data.skip;
      if (!prev.includes(component)) {
        components = [...prev, component];
      } else {
        components = prev;
      }
    } catch {
      // overwrite invalid marker
    }
  }

  const marker: ComponentMarkerData = { components, origin: existingOrigin };
  if (existingSkip && existingSkip.length > 0) marker.skip = existingSkip;

  await writeFile(markerPath, JSON.stringify(marker, null, 2) + "\n");
}

export async function discoverComponentPaths(
  cwd: string,
  components: Component[],
): Promise<ComponentPaths> {
  const paths: Partial<ComponentPaths> = {};

  const scan = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (EXCLUDE.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;

      const full = join(dir, entry.name);
      const marker = join(full, COMPONENT_MARKER);
      if (existsSync(marker)) {
        try {
          const data = JSON.parse(await readFile(marker, "utf-8"));
          const markerComponents: string[] = data.components ?? (data.component ? [data.component] : []);
          for (const mc of markerComponents) {
            if (components.includes(mc as Component)) {
              paths[mc as Component] = entry.name;
            }
          }
        } catch {
          // invalid marker, skip
        }
      }
    }
  };

  await scan(cwd);

  for (const c of components) {
    if (!paths[c]) paths[c] = c;
  }

  return paths as ComponentPaths;
}

export async function discoverComponentsFromMarkers(
  cwd: string,
): Promise<{ components: Component[]; paths: ComponentPaths }> {
  const components: Component[] = [];
  const paths: Partial<ComponentPaths> = {};

  const entries = await readdir(cwd, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (EXCLUDE.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;

    const full = join(cwd, entry.name);
    const marker = join(full, COMPONENT_MARKER);
    if (existsSync(marker)) {
      try {
        const data = JSON.parse(await readFile(marker, "utf-8"));
        const markerComponents: string[] = data.components ?? (data.component ? [data.component] : []);
        for (const mc of markerComponents) {
          if (COMPONENTS.includes(mc as Component) && !components.includes(mc as Component)) {
            components.push(mc as Component);
            paths[mc as Component] = entry.name;
          }
        }
      } catch {
        // invalid marker
      }
    }
  }

  for (const c of components) {
    if (!paths[c]) paths[c] = c;
  }

  return { components, paths: paths as ComponentPaths };
}

export function render(
  template: string,
  vars: Record<string, unknown>,
): string {
  const components = vars.components as string[];
  const projectName = vars.projectName as string;
  const lines = template.split("\n");
  const output: string[] = [];
  const stack: { active: boolean; matched: boolean }[] = [];

  for (const line of lines) {
    const ifMatch = line.match(/^<%\s*if\s*\((.+?)\)\s*\{?\s*%>$/);
    if (ifMatch) {
      const pmName = (vars.pm as { name?: string })?.name ?? "npm";
      const fn = new Function("components", "projectName", "pm", `return ${ifMatch[1]}`);
      const result = fn(components, projectName, pmName);
      stack.push({ active: result, matched: result });
      continue;
    }

    const elseIfMatch = line.match(/^<%\s*\}\s*else\s+if\s*\((.+?)\)\s*\{?\s*%>$/);
    if (elseIfMatch) {
      if (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.matched) {
          top.active = false;
        } else {
          const pmN = (vars.pm as { name?: string })?.name ?? "npm";
          const fn = new Function("components", "projectName", "pm", `return ${elseIfMatch[1]}`);
          const result = fn(components, projectName, pmN);
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

    const replaced = line.replace(
      /<%=\s*([\w.]+)\s*%>/g,
      (_, expr: string) => {
        const parts = expr.split(".");
        let val: unknown = vars;
        for (const p of parts) {
          val = (val as Record<string, unknown>)?.[p];
        }
        return String(val ?? "");
      },
    );
    output.push(replaced);
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n");
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
