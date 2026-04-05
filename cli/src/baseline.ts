import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile, rm } from "node:fs/promises";
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
  status: "clean" | "conflicts";
  conflictedFiles?: string[];
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

export async function writeTemplateToDir(
  dest: string,
  repoDir: string,
  components: Component[],
  componentPaths: ComponentPaths,
  vars: GeneratorVars,
  version: string,
  origin: ComponentOrigin,
  componentSkips?: Record<string, string[]>,
): Promise<void> {
  const name = vars.projectName;
  const nameSnake = toSnake(name);

  for (const component of components) {
    const targetDir = componentPaths[component];
    const skipPatterns = componentSkips?.[component] ?? [];

    // Copy to temp first, remove skipped files, then copy to target
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

  if (hasBackend || components.includes("frontend")) {
    await writeFile(join(dest, "docker-compose.yml"), await generateDockerCompose(vars));
    await writeFile(join(dest, "docker-compose.dev.yml"), await generateDockerComposeDev(vars));
  }

  await writeFile(join(dest, "README.md"), await generateReadme(vars));

  await mkdir(join(dest, ".githooks"), { recursive: true });
  await writeFile(join(dest, ".githooks/pre-commit"), await generatePreCommit(vars));
  await chmod(join(dest, ".githooks/pre-commit"), 0o755);

  await mkdir(join(dest, ".github/workflows"), { recursive: true });
  await writeFile(join(dest, ".github/workflows/ci.yml"), await generateCiYml(vars));

  await writeFile(join(dest, "setup.sh"), await generateSetupSh(vars));
  await chmod(join(dest, "setup.sh"), 0o755);

  await copyStaticFiles(repoDir, dest);

  await mkdir(join(dest, ".vscode"), { recursive: true });
  await writeFile(join(dest, ".vscode/settings.json"), generateVscodeSettings(vars));

  const projxConfig = {
    version,
    components,
    createdAt: new Date().toISOString().split("T")[0],
  };
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

export async function applyTemplate(
  cwd: string,
  repoDir: string,
  components: Component[],
  componentPaths: ComponentPaths,
  vars: GeneratorVars,
  version: string,
  origin: ComponentOrigin = "scaffold",
  componentSkips?: Record<string, string[]>,
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
    await writeTemplateToDir(cwd, repoDir, components, componentPaths, vars, version, origin, componentSkips);
    return { status: "clean" };
  }

  // Try merge first — if clean, commit automatically
  const { worktree, branch } = createOrphanWorktree(cwd);

  try {
    await writeTemplateToDir(worktree, repoDir, components, componentPaths, vars, version, origin, componentSkips);

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

    // Attempt merge
    let mergeClean = false;
    try {
      execSync(
        `git merge ${branch} --allow-unrelated-histories -m "projx: update to template v${version}"`,
        { cwd, stdio: "pipe" },
      );
      mergeClean = true;
    } catch {
      // Conflicts — abort and fall back to direct copy
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
      return { status: "clean" };
    }

    // Merge had conflicts — fall back to direct file copy
    // User reviews with git diff, commits what they want
    await writeTemplateToDir(cwd, repoDir, components, componentPaths, vars, version, origin, componentSkips);
    return { status: "conflicts" };

  } catch (err) {
    cleanupWorktree(cwd, worktree, branch);
    throw err;
  }
}
