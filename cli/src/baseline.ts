import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { chmod, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  type Component,
  type ComponentPaths,
  type ComponentOrigin,
  copyComponent,
  copyStaticFiles,
  replaceInFile,
  replaceInDir,
  toSnake,
  writeComponentMarker,
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
  [key: string]: unknown;
}

export interface MergeResult {
  status: "clean" | "merged" | "conflicts";
  mergedFiles?: string[];
  conflictedFiles?: string[];
}

export const BASELINE_REF = "refs/projx/baseline";

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
    const head = execSync("git rev-parse HEAD", { cwd, stdio: "pipe" }).toString().trim();
    execSync(`git update-ref ${BASELINE_REF} ${head}`, { cwd, stdio: "pipe" });
  } catch {
    // non-critical
  }
}

export function getBaselineRef(cwd: string): string | null {
  // Try explicit ref first
  try {
    return execSync(`git rev-parse --verify ${BASELINE_REF}`, { cwd, stdio: "pipe" }).toString().trim();
  } catch {
    // no explicit ref
  }

  // Fallback: find the commit that last modified .projx (= last template apply)
  try {
    const sha = execSync("git log -1 --format=%H -- .projx", { cwd, stdio: "pipe" }).toString().trim();
    if (sha) return sha;
  } catch {
    // no history
  }

  return null;
}

export function getFileAtRef(cwd: string, ref: string, filePath: string): string | null {
  try {
    return execSync(`git show ${ref}:"${filePath}"`, { cwd, stdio: "pipe" }).toString();
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
    execSync(`git merge-file "${oursPath}" "${baseTmp}" "${theirsTmp}"`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  } finally {
    try { unlinkSync(baseTmp); } catch { /* */ }
    try { unlinkSync(theirsTmp); } catch { /* */ }
  }
}

export async function collectAllFiles(dir: string, base: string): Promise<string[]> {
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

async function tryThreeWayMerge(
  cwd: string,
  templateDir: string,
  baselineRef: string,
): Promise<{ merged: string[]; conflicted: string[] }> {
  const templateFiles = await collectAllFiles(templateDir, templateDir);
  const merged: string[] = [];
  const conflicted: string[] = [];

  for (const file of templateFiles) {
    const oursPath = join(cwd, file);
    if (!existsSync(oursPath)) continue;

    const baseContent = getFileAtRef(cwd, baselineRef, file);
    if (baseContent === null) continue;

    let theirsContent: string;
    try {
      theirsContent = await readFile(join(templateDir, file), "utf-8");
    } catch {
      continue;
    }

    const oursContent = await readFile(oursPath, "utf-8");

    // Skip files where user hasn't changed from baseline (tier 1 would handle)
    if (oursContent === baseContent) continue;

    // Skip files where template hasn't changed from baseline
    if (theirsContent === baseContent) continue;

    // Both sides changed — need 3-way merge
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

function createOrphanWorktree(cwd: string): { worktree: string; branch: string } {
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
    execSync(`git worktree remove "${worktree}" --force`, { cwd, stdio: "pipe" });
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
      } else if (entry.name !== ".projx-component" && matchesSkip(rel, skipPatterns)) {
        await unlink(full);
      }
    }
  };

  await walk(dir, dir);
}

// --- Template writing ---

export async function writeTemplateToDir(
  dest: string,
  repoDir: string,
  components: Component[],
  componentPaths: ComponentPaths,
  vars: GeneratorVars,
  version: string,
  origin: ComponentOrigin,
  componentSkips?: Record<string, string[]>,
  rootSkip?: string[],
): Promise<void> {
  const name = vars.projectName;
  const nameSnake = toSnake(name);

  for (const component of components) {
    const targetDir = componentPaths[component];
    const skipPatterns = componentSkips?.[component] ?? [];

    const tmpDir = join(dest, "__cptmp__");
    await copyComponent(repoDir, component, tmpDir);
    const srcDir = join(tmpDir, component);

    if (skipPatterns.length > 0) {
      await removeSkippedFiles(srcDir, skipPatterns);
    }

    const outDir = join(dest, targetDir);
    await mkdir(outDir, { recursive: true });
    const { cp } = await import("node:fs/promises");
    if (existsSync(srcDir)) {
      await cp(srcDir, outDir, { recursive: true, force: true });
    }
    await rm(tmpDir, { recursive: true, force: true });

    await writeComponentMarker(join(dest, targetDir), component, origin, skipPatterns.length > 0 ? skipPatterns : undefined);
  }

  await substituteNames(dest, components, componentPaths, name, nameSnake);

  const hasBackend =
    components.includes("fastapi") || components.includes("fastify");

  const skip = rootSkip ?? [];
  const shouldWrite = (file: string) => !matchesSkip(file, skip);

  if (hasBackend || components.includes("frontend")) {
    if (shouldWrite("docker-compose.yml"))
      await writeFile(join(dest, "docker-compose.yml"), await generateDockerCompose(vars));
    if (shouldWrite("docker-compose.dev.yml"))
      await writeFile(join(dest, "docker-compose.dev.yml"), await generateDockerComposeDev(vars));
  }

  if (shouldWrite("README.md"))
    await writeFile(join(dest, "README.md"), await generateReadme(vars));

  if (shouldWrite(".githooks/pre-commit")) {
    await mkdir(join(dest, ".githooks"), { recursive: true });
    await writeFile(join(dest, ".githooks/pre-commit"), await generatePreCommit(vars));
    await chmod(join(dest, ".githooks/pre-commit"), 0o755);
  }

  if (shouldWrite(".github/workflows/ci.yml")) {
    await mkdir(join(dest, ".github/workflows"), { recursive: true });
    await writeFile(join(dest, ".github/workflows/ci.yml"), await generateCiYml(vars));
  }

  if (shouldWrite("setup.sh")) {
    await writeFile(join(dest, "setup.sh"), await generateSetupSh(vars));
    await chmod(join(dest, "setup.sh"), 0o755);
  }

  await copyStaticFiles(repoDir, dest);

  if (shouldWrite(".vscode/settings.json")) {
    await mkdir(join(dest, ".vscode"), { recursive: true });
    await writeFile(join(dest, ".vscode/settings.json"), generateVscodeSettings(vars));
  }

  const projxConfig: Record<string, unknown> = {
    version,
    components,
    createdAt: new Date().toISOString().split("T")[0],
  };
  const pmObj = vars.pm as { name?: string } | undefined;
  if (pmObj?.name) projxConfig.packageManager = pmObj.name;
  await writeFile(join(dest, ".projx"), JSON.stringify(projxConfig, null, 2) + "\n");
}

async function substituteNames(
  dest: string,
  components: Component[],
  paths: ComponentPaths,
  name: string,
  nameSnake: string,
): Promise<void> {
  if (components.includes("fastapi")) {
    await replaceInFile(join(dest, `${paths.fastapi}/pyproject.toml`), "projx-fastapi", `${name}-fastapi`);
  }
  if (components.includes("fastify")) {
    await replaceInFile(join(dest, `${paths.fastify}/package.json`), "projx-fastify", `${name}-fastify`);
  }
  if (components.includes("frontend")) {
    await replaceInFile(join(dest, `${paths.frontend}/package.json`), "projx-frontend", `${name}-frontend`);
  }
  if (components.includes("e2e")) {
    await replaceInFile(join(dest, `${paths.e2e}/package.json`), "projx-e2e", `${name}-e2e`);
  }
  if (components.includes("mobile")) {
    await replaceInFile(join(dest, `${paths.mobile}/pubspec.yaml`), "projx_mobile", `${nameSnake}_mobile`);
    await replaceInDir(join(dest, `${paths.mobile}`), "package:projx_mobile/", `package:${nameSnake}_mobile/`, ".dart");
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
  origin: ComponentOrigin = "scaffold",
  componentSkips?: Record<string, string[]>,
  rootSkip?: string[],
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
    await writeTemplateToDir(cwd, repoDir, components, componentPaths, vars, version, origin, componentSkips, rootSkip);
    return { status: "clean" };
  }

  // --- Write template into orphan worktree ---
  const { worktree, branch } = createOrphanWorktree(cwd);

  try {
    await writeTemplateToDir(worktree, repoDir, components, componentPaths, vars, version, origin, componentSkips, rootSkip);

    execSync("git add -A", { cwd: worktree, stdio: "pipe" });

    const diff = execSync("git diff --cached --stat", { cwd: worktree, stdio: "pipe" }).toString().trim();
    if (!diff) {
      cleanupWorktree(cwd, worktree, branch);
      return { status: "clean" };
    }

    execSync(
      `git commit --no-verify -m "projx: template v${version} [${components.join(", ")}]"`,
      { cwd: worktree, stdio: "pipe" },
    );

    // Remove worktree but keep branch for merging
    try {
      execSync(`git worktree remove "${worktree}" --force`, { cwd, stdio: "pipe" });
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
      saveBaselineRef(cwd);
      return { status: "clean" };
    }

    // --- Tier 2: Per-file 3-way merge using baseline ref ---
    const baselineRef = getBaselineRef(cwd);
    if (baselineRef) {
      const tmpTemplate = join(tmpdir(), `projx-tpl-${Date.now()}`);
      await mkdir(tmpTemplate, { recursive: true });
      await writeTemplateToDir(tmpTemplate, repoDir, components, componentPaths, vars, version, origin, componentSkips, rootSkip);

      const result = await tryThreeWayMerge(cwd, tmpTemplate, baselineRef);
      await rm(tmpTemplate, { recursive: true, force: true });

      const projxConfig: Record<string, unknown> = {
        version,
        components,
        createdAt: new Date().toISOString().split("T")[0],
      };
      const pmObj = vars.pm as { name?: string } | undefined;
  if (pmObj?.name) projxConfig.packageManager = pmObj.name;
      await writeFile(join(cwd, ".projx"), JSON.stringify(projxConfig, null, 2) + "\n");

      if (result.conflicted.length === 0) {
        // All clean — stage and commit
        execSync("git add -A", { cwd, stdio: "pipe" });
        const staged = execSync("git diff --cached --stat", { cwd, stdio: "pipe" }).toString().trim();
        if (staged) {
          execSync(
            `git commit --no-verify -m "projx: update to template v${version} (3-way merge)"`,
            { cwd, stdio: "pipe" },
          );
        }
        saveBaselineRef(cwd);
        return result.merged.length > 0
          ? { status: "merged", mergedFiles: result.merged }
          : { status: "clean" };
      }

      // Partial — stage clean merges, leave conflicts unstaged for review
      // Revert conflict markers from failed files (restore user's version)
      for (const f of result.conflicted) {
        try {
          execSync(`git checkout -- "${f}"`, { cwd, stdio: "pipe" });
        } catch {
          // file may be new/untracked
        }
      }

      // Stage the clean merges + .projx
      for (const f of result.merged) {
        try {
          execSync(`git add "${f}"`, { cwd, stdio: "pipe" });
        } catch {
          // best effort
        }
      }
      execSync("git add .projx", { cwd, stdio: "pipe" });

      return {
        status: "conflicts",
        mergedFiles: result.merged,
        conflictedFiles: result.conflicted,
      };
    }

    // --- Tier 3: Direct copy (no baseline available) ---
    // Overwrite template files, user reviews everything with git diff
    await writeTemplateToDir(cwd, repoDir, components, componentPaths, vars, version, origin, componentSkips, rootSkip);
    return { status: "conflicts" };

  } catch (err) {
    cleanupWorktree(cwd, worktree, branch);
    throw err;
  }
}
