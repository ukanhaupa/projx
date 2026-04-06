import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  COMPONENTS,
  COMPONENT_MARKER,
  type Component,
  type ComponentPaths,
  discoverComponentsFromMarkers,
  readComponentMarker,
} from "./utils.js";
import { BASELINE_REF, matchesSkip, saveBaselineRef } from "./baseline.js";

interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  fix?: string;
  autoFixable?: boolean;
}

interface ProjxConfig {
  version: string;
  components: Component[];
  createdAt: string;
  skip?: string[];
}

async function checkConfig(cwd: string): Promise<{ results: CheckResult[]; config?: ProjxConfig }> {
  const results: CheckResult[] = [];
  const configPath = join(cwd, ".projx");

  if (!existsSync(configPath)) {
    results.push({
      name: ".projx exists",
      status: "fail",
      message: "No .projx file found.",
      fix: "Run 'npx create-projx init' to initialize.",
    });
    return { results };
  }

  let config: ProjxConfig;
  try {
    config = JSON.parse(await readFile(configPath, "utf-8"));
  } catch {
    results.push({
      name: ".projx valid JSON",
      status: "fail",
      message: ".projx contains invalid JSON.",
    });
    return { results };
  }

  results.push({ name: ".projx exists", status: "pass", message: `v${config.version}` });

  if (!config.version || !config.components || !Array.isArray(config.components)) {
    results.push({
      name: ".projx fields",
      status: "fail",
      message: "Missing required fields (version, components).",
    });
    return { results };
  }

  const invalid = config.components.filter((c) => !COMPONENTS.includes(c));
  if (invalid.length > 0) {
    results.push({
      name: "component names",
      status: "warn",
      message: `Unknown components: ${invalid.join(", ")}`,
    });
  } else {
    results.push({ name: "component names", status: "pass", message: `${config.components.length} valid` });
  }

  return { results, config };
}

async function checkComponents(
  cwd: string,
  config: ProjxConfig,
  componentPaths: ComponentPaths,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const component of config.components) {
    const dir = componentPaths[component];
    const fullDir = join(cwd, dir);

    if (!existsSync(fullDir)) {
      results.push({
        name: `${component} directory`,
        status: "fail",
        message: `Directory ${dir}/ not found.`,
      });
      continue;
    }

    const marker = await readComponentMarker(fullDir);
    if (!marker) {
      results.push({
        name: `${component} marker`,
        status: "fail",
        message: `No ${COMPONENT_MARKER} in ${dir}/.`,
        fix: `Run 'npx create-projx update' to regenerate markers.`,
      });
      continue;
    }

    if (!marker.components.includes(component)) {
      results.push({
        name: `${component} marker`,
        status: "warn",
        message: `Marker in ${dir}/ does not list "${component}".`,
      });
    } else {
      const label = dir !== component ? `${dir}/ (${component})` : `${component}/`;
      results.push({ name: `${component} marker`, status: "pass", message: label });
    }
  }

  // Check for orphan markers
  try {
    const entries = await readdir(cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const markerPath = join(cwd, entry.name, COMPONENT_MARKER);
      if (!existsSync(markerPath)) continue;

      const isKnown = Object.values(componentPaths).includes(entry.name);
      if (!isKnown) {
        results.push({
          name: `orphan marker`,
          status: "warn",
          message: `${entry.name}/ has a ${COMPONENT_MARKER} but is not in .projx components.`,
        });
      }
    }
  } catch {
    // non-critical
  }

  return results;
}

function checkGit(cwd: string, fix: boolean): CheckResult[] {
  const results: CheckResult[] = [];

  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
    results.push({ name: "git repo", status: "pass", message: "OK" });
  } catch {
    results.push({ name: "git repo", status: "fail", message: "Not a git repository." });
    return results;
  }

  // Baseline ref
  try {
    const ref = execSync(`git rev-parse --verify ${BASELINE_REF}`, { cwd, stdio: "pipe" }).toString().trim();
    results.push({ name: "baseline ref", status: "pass", message: ref.slice(0, 8) });
  } catch {
    if (fix) {
      saveBaselineRef(cwd);
      try {
        execSync(`git rev-parse --verify ${BASELINE_REF}`, { cwd, stdio: "pipe" });
        results.push({ name: "baseline ref", status: "pass", message: "Created from git history." });
      } catch {
        results.push({
          name: "baseline ref",
          status: "warn",
          message: "Missing. Could not auto-create.",
          fix: "Run 'npx create-projx update' to establish baseline.",
        });
      }
    } else {
      results.push({
        name: "baseline ref",
        status: "warn",
        message: "Missing. Run 'projx doctor --fix' to create.",
        autoFixable: true,
      });
    }
  }

  // Stale worktrees
  try {
    const worktrees = execSync("git worktree list --porcelain", { cwd, stdio: "pipe" }).toString();
    const stale = worktrees.split("\n").filter((l) => l.includes("projx-wt-") || l.includes("projx/tmp-"));
    if (stale.length > 0) {
      if (fix) {
        execSync("git worktree prune", { cwd, stdio: "pipe" });
        results.push({ name: "worktrees", status: "pass", message: "Pruned stale worktrees." });
      } else {
        results.push({
          name: "worktrees",
          status: "warn",
          message: "Stale projx worktrees found.",
          fix: "Run 'projx doctor --fix' to prune.",
          autoFixable: true,
        });
      }
    } else {
      results.push({ name: "worktrees", status: "pass", message: "Clean" });
    }
  } catch {
    results.push({ name: "worktrees", status: "pass", message: "OK" });
  }

  // Working tree status
  try {
    const status = execSync("git status --porcelain", { cwd, stdio: "pipe" }).toString().trim();
    if (status) {
      const count = status.split("\n").length;
      results.push({ name: "working tree", status: "warn", message: `${count} uncommitted change(s).` });
    } else {
      results.push({ name: "working tree", status: "pass", message: "Clean" });
    }
  } catch {
    // non-critical
  }

  return results;
}

async function checkSkipPatterns(
  cwd: string,
  config: ProjxConfig,
  componentPaths: ComponentPaths,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Root skip patterns
  if (config.skip && config.skip.length > 0) {
    for (const pattern of config.skip) {
      const matches = await patternMatchesAnything(cwd, pattern);
      if (!matches) {
        results.push({
          name: "root skip",
          status: "warn",
          message: `"${pattern}" matches no files — stale?`,
        });
      }
    }
  }

  // Component skip patterns
  for (const component of config.components) {
    const dir = componentPaths[component];
    const marker = await readComponentMarker(join(cwd, dir));
    if (marker?.skip && marker.skip.length > 0) {
      for (const pattern of marker.skip) {
        const matches = await patternMatchesAnything(join(cwd, dir), pattern);
        if (!matches) {
          results.push({
            name: `${component} skip`,
            status: "warn",
            message: `"${pattern}" matches no files — stale?`,
          });
        }
      }
    }
  }

  if (results.length === 0 && (config.skip?.length || config.components.some(() => true))) {
    results.push({ name: "skip patterns", status: "pass", message: "All patterns match files." });
  }

  return results;
}

async function patternMatchesAnything(dir: string, pattern: string): Promise<boolean> {
  if (pattern === "**") return true;
  if (!existsSync(dir)) return false;

  const walk = async (current: string, base: string): Promise<boolean> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      const rel = full.slice(base.length + 1);

      if (entry.isDirectory()) {
        if (await walk(full, base)) return true;
      } else if (matchesSkip(rel, [pattern])) {
        return true;
      }
    }
    return false;
  };

  return walk(dir, dir);
}

export async function doctor(cwd: string, fix = false): Promise<void> {
  p.intro("projx doctor");

  const allResults: CheckResult[] = [];

  // Config checks
  const { results: configResults, config } = await checkConfig(cwd);
  allResults.push(...configResults);

  if (!config) {
    printReport(allResults);
    process.exit(1);
  }

  // Component checks
  const { components: discovered, paths: componentPaths } = await discoverComponentsFromMarkers(cwd);
  const resolvedConfig = { ...config, components: discovered.length > 0 ? discovered : config.components };
  allResults.push(...await checkComponents(cwd, resolvedConfig, componentPaths));

  // Git checks
  allResults.push(...checkGit(cwd, fix));

  // Skip pattern checks
  allResults.push(...await checkSkipPatterns(cwd, resolvedConfig, componentPaths));

  printReport(allResults);

  const passed = allResults.filter((r) => r.status === "pass").length;
  const warns = allResults.filter((r) => r.status === "warn").length;
  const fails = allResults.filter((r) => r.status === "fail").length;

  const fixable = allResults.filter((r) => r.autoFixable);
  if (fixable.length > 0 && !fix) {
    p.log.info(`${fixable.length} issue(s) auto-fixable with --fix`);
  }

  p.outro(`${passed} passed, ${warns} warning(s), ${fails} failed`);

  if (fails > 0) process.exit(1);
}

function printReport(results: CheckResult[]): void {
  for (const r of results) {
    const icon = r.status === "pass" ? "\u2713" : r.status === "warn" ? "\u26A0" : "\u2717";
    const msg = `${icon} ${r.name} \u2014 ${r.message}`;

    if (r.status === "pass") p.log.success(msg);
    else if (r.status === "warn") p.log.warn(msg);
    else p.log.error(msg);

    if (r.fix) p.log.info(`  ${r.fix}`);
  }
}
