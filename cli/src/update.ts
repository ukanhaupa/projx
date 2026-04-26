import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  COMPONENT_MARKER,
  type Component,
  type ComponentPaths,
  type PackageManager,
  cleanupRepo,
  detectPackageManagerFromComponents,
  detectProjectName,
  discoverComponentsFromMarkers,
  downloadRepo,
  pmCommands,
  readComponentMarker,
  readProjxConfig,
  writeComponentMarker,
  writeProjxConfig,
} from "./utils.js";
import {
  applyTemplate,
  detectPackageNameOverrides,
  saveBaselineRef,
  type GeneratorVars,
} from "./baseline.js";

export async function update(cwd: string, localRepo?: string): Promise<void> {
  p.intro("projx update");
  const isLocal = !!localRepo;

  if (!isGitRepo(cwd)) {
    p.log.error("projx update requires a git repo.");
    process.exit(1);
  }

  try {
    execSync("git worktree prune", { cwd, stdio: "pipe" });
  } catch {
    // non-critical
  }

  const raw = await readProjxConfig(cwd);
  const {
    components,
    paths: componentPaths,
    instances,
  } = await discoverComponentsFromMarkers(cwd);
  const extraInstances = instances.filter(
    (i) => componentPaths[i.type] !== i.path,
  );

  const pendingConflicts = findFilesWithConflictMarkers(cwd);
  if (pendingConflicts.length > 0) {
    p.log.warn(
      `Found ${pendingConflicts.length} file(s) with unresolved conflict markers from a prior update:`,
    );
    for (const f of pendingConflicts) p.log.info(`  ${f}`);
    p.log.info("");

    const resumeVersion = String(raw.version ?? "unknown");
    const handled = await promptSkipLearning(
      cwd,
      componentPaths,
      resumeVersion,
      pendingConflicts,
    );
    if (!handled) {
      p.log.info("");
      p.log.info(
        "Resolve manually with `git diff` then `git add` / `git checkout --`,",
      );
      p.log.info("or re-run `npx create-projx update` to resume the prompt.");
    }
    return;
  }

  if (hasUncommittedChanges(cwd)) {
    p.log.error("You have uncommitted changes. Commit or stash them first.");
    process.exit(1);
  }

  if (components.length === 0) {
    p.log.error("No projx components found. Run 'projx init' first.");
    process.exit(1);
  }

  if (Object.keys(raw).length > 0) {
    p.log.info(
      `Found .projx (v${raw.version ?? "unknown"}, components: ${components.join(", ")})`,
    );
  } else {
    p.log.warn("No .projx file found. Detected components from markers.");
    p.log.info(`Detected: ${components.join(", ")}`);
  }

  for (const c of components) {
    const dir = componentPaths[c];
    p.log.info(dir !== c ? `${c} → ${dir}/` : `${c}/`);
  }

  const componentSkips: Record<string, string[]> = {};
  for (const component of components) {
    const dir = componentPaths[component];
    const marker = await readComponentMarker(join(cwd, dir));
    if (marker?.skip && marker.skip.length > 0) {
      componentSkips[component] = marker.skip;
    }
  }

  const dlSpinner = p.spinner();
  dlSpinner.start(
    isLocal ? "Using local templates" : "Downloading latest templates",
  );
  const repoDir = await downloadRepo(localRepo).catch((err) => {
    dlSpinner.stop("Failed.");
    p.log.error(String(err));
    process.exit(1);
  });
  dlSpinner.stop(isLocal ? "Local templates loaded." : "Templates downloaded.");

  try {
    const pkg = JSON.parse(
      await readFile(join(repoDir, "cli/package.json"), "utf-8"),
    );
    const version = pkg.version;

    const name = detectProjectName(cwd, components, componentPaths);
    const recordedPm = raw.packageManager as PackageManager | undefined;
    const detectedPm = detectPackageManagerFromComponents(cwd, componentPaths);
    const pm: PackageManager = detectedPm ?? recordedPm ?? "npm";
    if (detectedPm && recordedPm && detectedPm !== recordedPm) {
      p.log.warn(
        `packageManager mismatch: .projx says "${recordedPm}" but lockfile is "${detectedPm}". Using "${detectedPm}".`,
      );
      await writeProjxConfig(cwd, { ...raw, packageManager: detectedPm });
    } else if (detectedPm && !recordedPm) {
      await writeProjxConfig(cwd, { ...raw, packageManager: detectedPm });
    }
    const nameOverrides = await detectPackageNameOverrides(
      cwd,
      components,
      componentPaths,
    );
    const vars: GeneratorVars = {
      projectName: name,
      components,
      paths: componentPaths,
      instances,
      pm: pmCommands(pm),
      nameOverrides,
    };

    const spinner = p.spinner();
    spinner.start("Applying template update");
    const rootSkip: string[] = Array.isArray(raw.skip)
      ? (raw.skip as string[])
      : [];
    const isLegacyMigration = !raw.defaultsApplied;
    if (isLegacyMigration) {
      p.log.info(
        "Legacy project detected — applying default skip patterns for user-owned files.",
      );
    }
    const result = await applyTemplate(
      cwd,
      repoDir,
      components,
      componentPaths,
      vars,
      version,
      componentSkips,
      rootSkip,
      isLegacyMigration,
      extraInstances,
    );
    spinner.stop("Template applied.");

    const pinnedUpdates = await findPinnedFilesWithUpdates(
      cwd,
      repoDir,
      components,
      componentPaths,
      vars,
      version,
      componentSkips,
      rootSkip,
    );
    if (pinnedUpdates.length > 0) {
      p.log.info("");
      p.log.info(
        `${pinnedUpdates.length} pinned file(s) have template updates available:`,
      );
      for (const f of pinnedUpdates) p.log.info(`  ${f}`);
      p.log.info(
        "Run `npx create-projx unpin <file> && npx create-projx update` to opt in.",
      );
    }

    if (result.status === "merged") {
      saveBaselineRef(cwd);
      p.log.success(
        `${result.mergedFiles?.length ?? 0} file(s) merged cleanly.`,
      );
      p.outro(`Updated to template v${version}.`);
    } else if (result.status === "conflicts") {
      if (result.mergedFiles && result.mergedFiles.length > 0) {
        p.log.success(
          `${result.mergedFiles.length} file(s) merged cleanly and staged.`,
        );
      }
      const conflictCount = result.conflictedFiles?.length ?? 0;
      if (conflictCount > 0) {
        p.log.warn(`${conflictCount} file(s) need review:`);
        for (const f of result.conflictedFiles!) {
          p.log.info(`  ${f}`);
        }
      }
      const handled = await promptSkipLearning(
        cwd,
        componentPaths,
        version,
        result.conflictedFiles ?? [],
      );
      if (!handled) {
        p.log.info("");
        p.log.info("Review:  git diff");
        p.log.info("Keep:    git add <file>");
        p.log.info("Discard: git checkout -- <file>");
        p.log.info(
          `Commit:  git add . && git commit -m "projx: update to v${version}"`,
        );
        p.outro(`Template v${version} applied. Review with git diff.`);
      }
    } else {
      saveBaselineRef(cwd);
      p.outro(`Updated to template v${version}.`);
    }
  } catch (err) {
    p.log.error(`Update failed: ${err}`);
    process.exit(1);
  } finally {
    await cleanupRepo(repoDir, isLocal);
  }
}

function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function hasUncommittedChanges(cwd: string): boolean {
  try {
    const status = execSync("git status --porcelain", { cwd, stdio: "pipe" })
      .toString()
      .trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

export async function findPinnedFilesWithUpdates(
  cwd: string,
  repoDir: string,
  components: Component[],
  componentPaths: ComponentPaths,
  vars: GeneratorVars,
  version: string,
  componentSkips: Record<string, string[]> | undefined,
  rootSkip: string[],
): Promise<string[]> {
  const { mkdir, rm, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { writeTemplateToDir } = await import("./baseline.js");

  const config = await readProjxConfig(cwd);
  const rootPinned: string[] = Array.isArray(config.skip)
    ? (config.skip as string[])
    : [];
  const componentPinned: {
    component: Component;
    dir: string;
    patterns: string[];
  }[] = [];
  for (const component of components) {
    const dir = componentPaths[component];
    const marker = await readComponentMarker(join(cwd, dir));
    if (marker?.skip && marker.skip.length > 0) {
      componentPinned.push({ component, dir, patterns: marker.skip });
    }
  }
  if (rootPinned.length === 0 && componentPinned.length === 0) return [];

  const tmpTemplate = join(tmpdir(), `projx-pinned-${Date.now()}`);
  await mkdir(tmpTemplate, { recursive: true });

  void componentSkips;
  void rootSkip;

  try {
    await writeTemplateToDir(
      tmpTemplate,
      repoDir,
      components,
      componentPaths,
      vars,
      version,
      {
        componentSkips: {},
        rootSkip: [],
        realCwd: tmpTemplate,
      },
    );

    const updates: string[] = [];

    for (const file of rootPinned) {
      const tmplPath = join(tmpTemplate, file);
      const userPath = join(cwd, file);
      if (!existsSync(tmplPath) || !existsSync(userPath)) continue;
      const tmplContent = await readFile(tmplPath, "utf-8");
      const userContent = await readFile(userPath, "utf-8");
      if (tmplContent !== userContent) updates.push(file);
    }

    for (const { dir, patterns } of componentPinned) {
      for (const pattern of patterns) {
        if (pattern.includes("*")) continue;
        const rel = `${dir}/${pattern}`;
        const tmplPath = join(tmpTemplate, rel);
        const userPath = join(cwd, rel);
        if (!existsSync(tmplPath) || !existsSync(userPath)) continue;
        const tmplContent = await readFile(tmplPath, "utf-8");
        const userContent = await readFile(userPath, "utf-8");
        if (tmplContent !== userContent) updates.push(rel);
      }
    }

    return updates;
  } finally {
    await rm(tmpTemplate, { recursive: true, force: true });
  }
}

export function findFilesWithConflictMarkers(cwd: string): string[] {
  try {
    const out = execSync(
      `git -c core.quotepath=off grep -lE '^<<<<<<< (your changes|HEAD)'`,
      { cwd, stdio: "pipe" },
    )
      .toString()
      .trim();
    if (!out) return [];
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function promptSkipLearning(
  cwd: string,
  componentPaths: ComponentPaths,
  version: string,
  conflictedFiles: string[],
): Promise<boolean> {
  const changedFiles = conflictedFiles.filter((f) => {
    const base = f.split("/").pop()!;
    if (base === ".projx" || base === COMPONENT_MARKER) return false;
    return true;
  });

  if (changedFiles.length === 0) return false;

  if (!process.stdin.isTTY) {
    p.log.info(
      "Non-interactive: skipping prompt. Resolve conflicts manually with `git diff` then `git add`.",
    );
    p.log.info(
      "Re-run `npx create-projx update` later to interactively decide which files to keep.",
    );
    return false;
  }

  const statusOutput = execSync("git status --porcelain", {
    cwd,
    stdio: "pipe",
  })
    .toString()
    .trim();
  const entries = statusOutput
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim(),
      file: line.slice(3).trim(),
    }));

  p.log.warn(`${changedFiles.length} file(s) have conflicts to resolve.`);
  p.log.info(
    "Each file is currently in your working tree with conflict markers.",
  );
  p.log.info("");
  p.log.info(
    "CHECKED  = keep your version, resolve markers manually, commit when ready",
  );
  p.log.info(
    "UNCHECKED = discard template's changes AND skip this file on future updates",
  );
  p.log.info("");

  const selected = (await p.multiselect({
    message: "Which files do you want to KEEP?",
    options: changedFiles.map((f) => ({ value: f, label: f })),
    required: false,
  })) as string[] | symbol;

  if (p.isCancel(selected)) {
    p.log.warn("Cancelled. Conflict markers remain in the working tree.");
    p.log.info("Re-run `npx create-projx update` later to resume the prompt.");
    return false;
  }

  const kept = new Set(selected as string[]);
  const discarded = changedFiles.filter((f) => !kept.has(f));

  if (discarded.length > 0) {
    for (const file of discarded) {
      const entry = entries.find((e) => e.file === file);
      try {
        if (entry?.status === "??") {
          await unlink(join(cwd, file));
        } else {
          execSync(`git checkout -- "${file}"`, { cwd, stdio: "pipe" });
        }
      } catch {
        // best effort
      }
    }

    await learnSkips(cwd, discarded, componentPaths);
    p.log.success(
      `Discarded ${discarded.length} file(s) and added to skip list.`,
    );
  }

  if (kept.size > 0) {
    p.log.info(
      `${kept.size} file(s) kept with conflict markers — resolve and commit:`,
    );
    p.log.info(`  git add . && git commit -m "projx: update to v${version}"`);
    p.outro(`Template v${version} applied.`);
  } else {
    p.outro("All template changes discarded. Skip list updated.");
  }

  return true;
}

export async function learnSkips(
  cwd: string,
  files: string[],
  componentPaths: ComponentPaths,
): Promise<void> {
  const componentSkipAdds: Record<string, string[]> = {};
  const rootSkipAdds: string[] = [];

  const dirToComponent: Record<string, string> = {};
  for (const [component, dir] of Object.entries(componentPaths)) {
    dirToComponent[dir] = component;
  }

  for (const file of files) {
    let matched = false;
    for (const [dir, component] of Object.entries(dirToComponent)) {
      if (file.startsWith(dir + "/")) {
        const relative = file.slice(dir.length + 1);
        if (!componentSkipAdds[component]) componentSkipAdds[component] = [];
        componentSkipAdds[component].push(relative);
        matched = true;
        break;
      }
    }
    if (!matched) {
      rootSkipAdds.push(file);
    }
  }

  for (const [component, additions] of Object.entries(componentSkipAdds)) {
    const dir = componentPaths[component as Component];
    const marker = await readComponentMarker(join(cwd, dir));
    if (!marker) continue;
    const merged = [...new Set([...marker.skip, ...additions])];
    await writeComponentMarker(join(cwd, dir), { ...marker, skip: merged });
  }

  if (rootSkipAdds.length > 0) {
    const config = await readProjxConfig(cwd);
    const existing: string[] = Array.isArray(config.skip)
      ? (config.skip as string[])
      : [];
    const merged = [...new Set([...existing, ...rootSkipAdds])];
    await writeProjxConfig(cwd, { ...config, skip: merged });
  }
}
