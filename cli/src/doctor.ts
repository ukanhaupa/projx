import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  COMPONENT_MARKER,
  type Component,
  type ComponentPaths,
  discoverComponentsFromMarkers,
  readComponentMarker,
  readProjxConfig,
} from "./utils.js";
import { BASELINE_REF, matchesSkip, saveBaselineRef } from "./baseline.js";

interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  fix?: string;
  autoFixable?: boolean;
}

async function checkConfig(cwd: string): Promise<{
  results: CheckResult[];
  rootConfig?: Record<string, unknown>;
}> {
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

  const rootConfig = await readProjxConfig(cwd);
  if (Object.keys(rootConfig).length === 0) {
    results.push({
      name: ".projx valid JSON",
      status: "fail",
      message: ".projx contains invalid JSON or is empty.",
    });
    return { results };
  }

  results.push({ name: ".projx exists", status: "pass", message: `v${rootConfig.version ?? "unknown"}` });

  if (!rootConfig.version) {
    results.push({
      name: ".projx fields",
      status: "warn",
      message: "Missing version field.",
    });
  }

  return { results, rootConfig };
}

async function checkComponents(
  cwd: string,
  components: Component[],
  componentPaths: ComponentPaths,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  if (components.length === 0) {
    results.push({
      name: "components",
      status: "fail",
      message: `No ${COMPONENT_MARKER} files found in any directory.`,
      fix: "Run 'npx create-projx init' to detect and mark components.",
    });
    return results;
  }

  results.push({ name: "components", status: "pass", message: `${components.length} discovered from markers` });

  for (const component of components) {
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

    const label = dir !== component ? `${dir}/ (${component})` : `${component}/`;
    results.push({ name: `${component} marker`, status: "pass", message: label });
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
  rootConfig: Record<string, unknown>,
  components: Component[],
  componentPaths: ComponentPaths,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const rootSkip: string[] = Array.isArray(rootConfig.skip) ? (rootConfig.skip as string[]) : [];
  for (const pattern of rootSkip) {
    const matches = await patternMatchesAnything(cwd, pattern);
    if (!matches) {
      results.push({
        name: "root skip",
        status: "warn",
        message: `"${pattern}" matches no files — stale?`,
      });
    }
  }

  for (const component of components) {
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

  if (results.length === 0 && (rootSkip.length > 0 || components.length > 0)) {
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

  const { results: configResults, rootConfig } = await checkConfig(cwd);
  allResults.push(...configResults);

  if (!rootConfig) {
    printReport(allResults);
    process.exit(1);
  }

  const { components, paths: componentPaths } = await discoverComponentsFromMarkers(cwd);
  allResults.push(...await checkComponents(cwd, components, componentPaths));

  allResults.push(...checkGit(cwd, fix));

  allResults.push(...await checkSkipPatterns(cwd, rootConfig, components, componentPaths));

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
