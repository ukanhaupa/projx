import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
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

export interface Options {
  name: string;
  components: Component[];
  git: boolean;
  install: boolean;
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

  const gitignore = join(tpl, ".gitignore");
  if (existsSync(gitignore)) {
    await cp(gitignore, join(dest, ".gitignore"));
    manifest.push(".gitignore");
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
  origin: ComponentOrigin;
}

export async function writeComponentMarker(
  dir: string,
  component: Component,
  origin: ComponentOrigin = "scaffold",
): Promise<void> {
  const markerPath = join(dir, COMPONENT_MARKER);
  let components: string[] = [component];
  let existingOrigin: ComponentOrigin = origin;

  const existing = await readFileOrNull(markerPath);
  if (existing) {
    try {
      const data = JSON.parse(existing);
      const prev: string[] = data.components ?? (data.component ? [data.component] : []);
      existingOrigin = data.origin ?? origin;
      if (!prev.includes(component)) {
        components = [...prev, component];
      } else {
        return;
      }
    } catch {
      // overwrite invalid marker
    }
  }

  await writeFile(
    markerPath,
    JSON.stringify({ components, origin: existingOrigin }, null, 2) + "\n",
  );
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

export function render(
  template: string,
  vars: Record<string, unknown>,
): string {
  const components = vars.components as string[];
  const projectName = vars.projectName as string;
  const lines = template.split("\n");
  const output: string[] = [];
  const stack: boolean[] = [];

  for (const line of lines) {
    const ifMatch = line.match(/^<%\s*if\s*\((.+?)\)\s*\{?\s*%>$/);
    if (ifMatch) {
      const fn = new Function("components", "projectName", `return ${ifMatch[1]}`);
      stack.push(fn(components, projectName));
      continue;
    }

    if (/^<%\s*\}\s*else\s*\{?\s*%>$/.test(line)) {
      if (stack.length > 0) {
        stack[stack.length - 1] = !stack[stack.length - 1];
      }
      continue;
    }

    if (/^<%\s*\}?\s*%>$/.test(line)) {
      stack.pop();
      continue;
    }

    if (stack.length > 0 && stack.some((v) => !v)) continue;

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
