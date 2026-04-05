import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile, rm } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as p from "@clack/prompts";
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

const BASELINE_BRANCH = "projx/baseline";

export interface GeneratorVars {
  projectName: string;
  components: Component[];
  paths: ComponentPaths;
  [key: string]: unknown;
}

export interface MergeResult {
  status: "clean" | "conflicts" | "up-to-date";
  conflictedFiles?: string[];
}

export function hasBaseline(cwd: string): boolean {
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${BASELINE_BRANCH}`, {
      cwd,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

function createWorktree(cwd: string, branch: string, orphan: boolean): string {
  const worktree = join(tmpdir(), `projx-baseline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  if (orphan) {
    execSync(`git worktree add --orphan -b ${branch} "${worktree}"`, {
      cwd,
      stdio: "pipe",
    });
  } else {
    execSync(`git worktree add "${worktree}" ${branch}`, {
      cwd,
      stdio: "pipe",
    });
  }

  return worktree;
}

function removeWorktree(cwd: string, worktree: string): void {
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

async function writeTemplateToDir(
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

    if (targetDir === component) {
      await copyComponent(repoDir, component, dest);
    } else {
      await copyComponent(repoDir, component, join(dest, "__tmp__"));
      const { cp } = await import("node:fs/promises");
      const srcDir = join(dest, "__tmp__", component);
      const outDir = join(dest, targetDir);
      if (existsSync(srcDir)) {
        await cp(srcDir, outDir, { recursive: true, force: true });
      }
      await rm(join(dest, "__tmp__"), { recursive: true, force: true });
    }

    const skipPatterns = componentSkips?.[component] ?? [];
    if (skipPatterns.length > 0) {
      await removeSkippedFiles(join(dest, targetDir), skipPatterns);
    }

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
    baseline: {
      branch: BASELINE_BRANCH,
      templateVersion: version,
    },
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

export async function createBaseline(
  cwd: string,
  repoDir: string,
  components: Component[],
  componentPaths: ComponentPaths,
  vars: GeneratorVars,
  version: string,
  origin: ComponentOrigin = "scaffold",
  componentSkips?: Record<string, string[]>,
): Promise<void> {
  const worktree = createWorktree(cwd, BASELINE_BRANCH, true);

  try {
    await writeTemplateToDir(worktree, repoDir, components, componentPaths, vars, version, origin, componentSkips);

    execSync("git add -A", { cwd: worktree, stdio: "pipe" });
    execSync(
      `git commit --no-verify -m "projx: baseline template v${version} [${components.join(", ")}]"`,
      { cwd: worktree, stdio: "pipe" },
    );
  } finally {
    removeWorktree(cwd, worktree);
  }
}

export async function updateBaseline(
  cwd: string,
  repoDir: string,
  components: Component[],
  componentPaths: ComponentPaths,
  vars: GeneratorVars,
  version: string,
  componentSkips?: Record<string, string[]>,
): Promise<{ changed: boolean }> {
  const worktree = createWorktree(cwd, BASELINE_BRANCH, false);

  try {
    execSync("git rm -rf .", { cwd: worktree, stdio: "pipe" });

    await writeTemplateToDir(worktree, repoDir, components, componentPaths, vars, version, "scaffold", componentSkips);

    execSync("git add -A", { cwd: worktree, stdio: "pipe" });

    const diff = execSync("git diff --cached --stat", { cwd: worktree, stdio: "pipe" }).toString().trim();
    if (!diff) {
      return { changed: false };
    }

    execSync(
      `git commit --no-verify -m "projx: update baseline to template v${version}"`,
      { cwd: worktree, stdio: "pipe" },
    );

    return { changed: true };
  } finally {
    removeWorktree(cwd, worktree);
  }
}

export async function addToBaseline(
  cwd: string,
  repoDir: string,
  newComponents: Component[],
  allComponents: Component[],
  componentPaths: ComponentPaths,
  vars: GeneratorVars,
  version: string,
): Promise<void> {
  const worktree = createWorktree(cwd, BASELINE_BRANCH, false);

  try {
    await writeTemplateToDir(worktree, repoDir, allComponents, componentPaths, vars, version, "scaffold");

    execSync("git add -A", { cwd: worktree, stdio: "pipe" });
    execSync(
      `git commit --no-verify -m "projx: add ${newComponents.join(", ")} template v${version}"`,
      { cwd: worktree, stdio: "pipe" },
    );
  } finally {
    removeWorktree(cwd, worktree);
  }
}

export function mergeBaseline(
  cwd: string,
  message: string,
  allowUnrelated = false,
  oursOnConflict = false,
): MergeResult {
  const args = [`git merge ${BASELINE_BRANCH}`];
  args.push(`-m "${message}"`);
  if (allowUnrelated) args.push("--allow-unrelated-histories");

  if (oursOnConflict) {
    try {
      execSync(`${args.join(" ")} --no-commit`, { cwd, stdio: "pipe" });
    } catch {
      // conflicts expected
    }
    execSync("git checkout --ours .", { cwd, stdio: "pipe" });
    execSync("git add -A", { cwd, stdio: "pipe" });
    execSync(`git commit --no-verify --no-edit -m "${message}"`, { cwd, stdio: "pipe" });
    return { status: "clean" };
  }

  try {
    execSync(args.join(" "), { cwd, stdio: "pipe" });
    return { status: "clean" };
  } catch {
    const conflicted = execSync("git diff --name-only --diff-filter=U", { cwd, stdio: "pipe" })
      .toString()
      .trim();

    if (!conflicted) {
      return { status: "clean" };
    }

    return {
      status: "conflicts",
      conflictedFiles: conflicted.split("\n").filter(Boolean),
    };
  }
}

export async function reconstructBaseline(
  cwd: string,
  repoDir: string,
  components: Component[],
  componentPaths: ComponentPaths,
  vars: GeneratorVars,
  version: string,
  componentSkips?: Record<string, string[]>,
): Promise<void> {
  p.log.warn("projx/baseline branch not found. Reconstructing...");

  await createBaseline(cwd, repoDir, components, componentPaths, vars, version, "scaffold", componentSkips);

  mergeBaseline(
    cwd,
    `projx: reconstructed baseline for template v${version}`,
    true,
    true,
  );

  p.log.success("Baseline reconstructed.");
}
