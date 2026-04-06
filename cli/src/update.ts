import { existsSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  COMPONENT_MARKER,
  type Component,
  type ComponentPaths,
  cleanupRepo,
  detectProjectName,
  discoverComponentPaths,
  discoverComponentsFromMarkers,
  downloadRepo,
  readComponentMarker,
} from "./utils.js";
import { applyTemplate, saveBaselineRef, type GeneratorVars } from "./baseline.js";

interface ProjxConfig {
  version: string;
  components: Component[];
  createdAt: string;
  skip?: string[];
}

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

  if (hasUncommittedChanges(cwd)) {
    p.log.error("You have uncommitted changes. Commit or stash them first.");
    process.exit(1);
  }

  const configPath = join(cwd, ".projx");
  let config: ProjxConfig;

  if (existsSync(configPath)) {
    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    const { components: discovered } = await discoverComponentsFromMarkers(cwd);
    config = { ...raw, components: discovered.length > 0 ? discovered : raw.components };
    p.log.info(`Found .projx (v${config.version}, components: ${config.components.join(", ")})`);
  } else {
    p.log.warn("No .projx file found. Detecting components from directories.");
    const { components: discovered } = await discoverComponentsFromMarkers(cwd);
    if (discovered.length === 0) {
      p.log.error("No projx components found. Run 'projx init' first.");
      process.exit(1);
    }
    config = { version: "0.0.0", components: discovered, createdAt: "unknown" };
    p.log.info(`Detected: ${discovered.join(", ")}`);
  }

  const componentPaths = await discoverComponentPaths(cwd, config.components);
  for (const c of config.components) {
    const dir = componentPaths[c];
    p.log.info(dir !== c ? `${c} → ${dir}/` : `${c}/`);
  }

  const componentSkips: Record<string, string[]> = {};
  for (const component of config.components) {
    const dir = componentPaths[component];
    const marker = await readComponentMarker(join(cwd, dir));
    if (marker?.skip && marker.skip.length > 0) {
      componentSkips[component] = marker.skip;
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

    const spinner = p.spinner();
    spinner.start("Applying template update");
    const rootSkip = config.skip ?? [];
    const result = await applyTemplate(cwd, repoDir, config.components, componentPaths, vars, version, "scaffold", componentSkips, rootSkip);
    spinner.stop("Template applied.");

    if (result.status === "merged") {
      saveBaselineRef(cwd);
      p.log.success(`${result.mergedFiles?.length ?? 0} file(s) merged cleanly.`);
      p.outro(`Updated to template v${version}.`);
    } else if (result.status === "conflicts") {
      if (result.mergedFiles && result.mergedFiles.length > 0) {
        p.log.success(`${result.mergedFiles.length} file(s) merged cleanly and staged.`);
      }
      const conflictCount = result.conflictedFiles?.length ?? 0;
      if (conflictCount > 0) {
        p.log.warn(`${conflictCount} file(s) need review:`);
        for (const f of result.conflictedFiles!) {
          p.log.info(`  ${f}`);
        }
      }
      const handled = await promptSkipLearning(cwd, componentPaths, version);
      if (!handled) {
        p.log.info("");
        p.log.info("Review:  git diff");
        p.log.info("Keep:    git add <file>");
        p.log.info("Discard: git checkout -- <file>");
        p.log.info(`Commit:  git add . && git commit -m "projx: update to v${version}"`);
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
    const status = execSync("git status --porcelain", { cwd, stdio: "pipe" }).toString().trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

async function promptSkipLearning(
  cwd: string,
  componentPaths: ComponentPaths,
  version: string,
): Promise<boolean> {
  if (!process.stdin.isTTY) return false;

  const statusOutput = execSync("git status --porcelain", { cwd, stdio: "pipe" })
    .toString()
    .trim();
  if (!statusOutput) return false;

  const entries = statusOutput.split("\n").filter(Boolean).map((line) => ({
    status: line.slice(0, 2).trim(),
    file: line.slice(3).trim(),
  }));

  const changedFiles = entries
    .map((e) => e.file)
    .filter((f) => {
      const base = f.split("/").pop()!;
      if (base === ".projx" || base === COMPONENT_MARKER) return false;
      return true;
    });

  if (changedFiles.length === 0) return false;

  p.log.warn(`${changedFiles.length} template file(s) differ from your code.`);

  const selected = (await p.multiselect({
    message:
      "Select files to KEEP (unselected will be discarded and skipped on future updates)",
    options: changedFiles.map((f) => ({ value: f, label: f })),
    required: false,
  })) as string[] | symbol;

  if (p.isCancel(selected)) return false;

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
    p.log.info(`${kept.size} file(s) kept — commit when ready:`);
    p.log.info(
      `  git add . && git commit -m "projx: update to v${version}"`,
    );
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
    const markerPath = join(cwd, dir, COMPONENT_MARKER);
    try {
      const data = JSON.parse(await readFile(markerPath, "utf-8"));
      const existing: string[] = data.skip ?? [];
      data.skip = [...new Set([...existing, ...additions])];
      await writeFile(markerPath, JSON.stringify(data, null, 2) + "\n");
    } catch {
      // marker missing or invalid
    }
  }

  if (rootSkipAdds.length > 0) {
    const configPath = join(cwd, ".projx");
    try {
      const data = JSON.parse(await readFile(configPath, "utf-8"));
      const existing: string[] = data.skip ?? [];
      data.skip = [...new Set([...existing, ...rootSkipAdds])];
      await writeFile(configPath, JSON.stringify(data, null, 2) + "\n");
    } catch {
      // config missing or invalid
    }
  }
}

