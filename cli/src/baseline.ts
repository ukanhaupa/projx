import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import {
  chmod,
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
  generateDockerComposeDev,
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
    components.includes("fastapi") || components.includes("fastify");

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
    if (shouldWrite("docker-compose.dev.yml"))
      await writeFile(
        join(dest, "docker-compose.dev.yml"),
        await generateDockerComposeDev(vars),
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
  for (const c of ["fastify", "frontend", "e2e"] as const) {
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
      const tmpTemplate = join(tmpdir(), `projx-tpl-${Date.now()}`);
      await mkdir(tmpTemplate, { recursive: true });
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
