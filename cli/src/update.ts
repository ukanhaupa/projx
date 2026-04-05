import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  COMPONENTS,
  type Component,
  type ComponentPaths,
  cleanupRepo,
  discoverComponentPaths,
  downloadRepo,
  readComponentMarker,
  toKebab,
} from "./utils.js";
import {
  hasBaseline,
  updateBaseline,
  mergeBaseline,
  reconstructBaseline,
  type GeneratorVars,
} from "./baseline.js";

interface ProjxConfig {
  version: string;
  components: Component[];
  createdAt: string;
  baseline?: {
    branch: string;
    templateVersion: string;
  };
}

export async function update(cwd: string, localRepo?: string): Promise<void> {
  p.intro("projx update");
  const isLocal = !!localRepo;

  if (!isGitRepo(cwd)) {
    p.log.error("projx update requires a git repo. Run 'git init && git add -A && git commit -m \"initial\"' first.");
    process.exit(1);
  }

  if (hasUncommittedChanges(cwd)) {
    p.log.error("You have uncommitted changes. Commit or stash them first.");
    process.exit(1);
  }

  const configPath = join(cwd, ".projx");
  let config: ProjxConfig;

  if (existsSync(configPath)) {
    config = JSON.parse(await readFile(configPath, "utf-8"));
    p.log.info(`Found .projx (v${config.version}, components: ${config.components.join(", ")})`);
  } else {
    p.log.warn("No .projx file found. Detecting components from directories.");
    const detected = COMPONENTS.filter((c) => existsSync(join(cwd, c))) as Component[];
    if (detected.length === 0) {
      p.log.error("No projx components found. Run 'projx init' first.");
      process.exit(1);
    }
    config = {
      version: "0.0.0",
      components: detected,
      createdAt: "unknown",
    };
    p.log.info(`Detected: ${detected.join(", ")}`);
  }

  const componentPaths = await discoverComponentPaths(cwd, config.components);
  const remapped = config.components.filter((c) => componentPaths[c] !== c);
  if (remapped.length > 0) {
    for (const c of remapped) {
      p.log.info(`${c} → ${componentPaths[c]}/`);
    }
  }

  const dlSpinner = p.spinner();
  dlSpinner.start(isLocal ? "Using local templates" : "Downloading latest templates");
  const repoDir = await downloadRepo(localRepo).catch((err) => {
    dlSpinner.stop("Failed.");
    p.log.error(String(err));
    process.exit(1);
  });
  dlSpinner.stop(isLocal ? "Local templates loaded." : "Templates downloaded.");

  try {
    const pkg = JSON.parse(await readFile(join(repoDir, "cli/package.json"), "utf-8"));
    const version = pkg.version;

    const name = detectProjectName(cwd, config.components, componentPaths);
    const vars: GeneratorVars = { projectName: name, components: config.components, paths: componentPaths };

    const componentSkips: Record<string, string[]> = {};
    for (const component of config.components) {
      const dir = componentPaths[component];
      const marker = await readComponentMarker(join(cwd, dir));
      if (marker?.skip && marker.skip.length > 0) {
        componentSkips[component] = marker.skip;
      } else if (marker?.origin === "init") {
        componentSkips[component] = ["**"];
      }
    }

    if (!hasBaseline(cwd)) {
      const rebuildSpinner = p.spinner();
      rebuildSpinner.start("Establishing baseline (first-time migration)");
      await reconstructBaseline(cwd, repoDir, config.components, componentPaths, vars, config.version || version, componentSkips);
      rebuildSpinner.stop("Baseline established.");
    }

    const updateSpinner = p.spinner();
    updateSpinner.start("Updating baseline to latest template");
    const { changed } = await updateBaseline(cwd, repoDir, config.components, componentPaths, vars, version, componentSkips);

    if (!changed) {
      updateSpinner.stop("Already up to date.");
      p.outro("No template changes to apply.");
      return;
    }
    updateSpinner.stop("Baseline updated.");

    const mergeSpinner = p.spinner();
    mergeSpinner.start("Merging template changes");
    const result = mergeBaseline(cwd, `projx: update to template v${version}`);
    mergeSpinner.stop("Merge complete.");

    if (result.status === "conflicts") {
      p.log.warn(`Merge conflicts in ${result.conflictedFiles!.length} file(s):`);
      for (const f of result.conflictedFiles!) {
        p.log.message(`  ${f}`);
      }
      p.outro(
        "Resolve conflicts, then:\n" +
        "  git add . && git commit\n\n" +
        "Or abort:\n" +
        "  git merge --abort"
      );
    } else {
      p.outro(`Updated to template v${version}. All changes merged cleanly.`);
    }
  } catch (err) {
    try { execSync("git merge --abort", { cwd, stdio: "pipe" }); } catch { /* may not be in merge */ }
    p.log.error(`Update failed: ${err}`);
    p.log.info("Your code is safe. Run 'git merge --abort' if needed.");
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
    const status = execSync("git status --porcelain", { cwd, stdio: "pipe" }).toString().trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

function detectProjectName(
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
