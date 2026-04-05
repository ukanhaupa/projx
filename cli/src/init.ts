import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  COMPONENTS,
  type Component,
  type ComponentPaths,
  cleanupRepo,
  downloadRepo,
  toKebab,
} from "./utils.js";
import { LABELS } from "./prompts.js";
import { detectComponents, type DetectedComponent } from "./detect.js";
import { createBaseline, mergeBaseline, type GeneratorVars } from "./baseline.js";

export async function init(
  cwd: string,
  localRepo?: string,
): Promise<void> {
  p.intro("projx init");
  const isLocal = !!localRepo;

  if (existsSync(join(cwd, ".projx"))) {
    p.log.error("This project is already initialized. Use 'projx update' or 'projx add' instead.");
    process.exit(1);
  }

  if (!isGitRepo(cwd)) {
    p.log.error("projx init requires a git repo. Run 'git init && git add -A && git commit -m \"initial\"' first.");
    process.exit(1);
  }

  if (hasUncommittedChanges(cwd)) {
    p.log.error("You have uncommitted changes. Commit or stash them first.");
    process.exit(1);
  }

  const spinner = p.spinner();
  spinner.start("Scanning for components");
  const detected = await detectComponents(cwd);
  spinner.stop(
    detected.length > 0
      ? `Found ${detected.length} component(s).`
      : "No components detected.",
  );

  let confirmed: { component: Component; directory: string }[];

  if (detected.length > 0) {
    confirmed = await confirmDetections(detected);
  } else {
    confirmed = await manualSelect(cwd);
  }

  if (confirmed.length === 0) {
    p.log.warn("No components selected. Nothing to do.");
    process.exit(0);
  }

  const components = confirmed.map((c) => c.component);
  const paths = Object.fromEntries(
    confirmed.map((c) => [c.component, c.directory]),
  ) as ComponentPaths;

  const projectName = toKebab(cwd.split("/").pop()!);
  const vars: GeneratorVars = { projectName, components, paths };

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

    const componentSkips: Record<string, string[]> = {};
    for (const c of components) {
      componentSkips[c] = ["**"];
    }

    const baselineSpinner = p.spinner();
    baselineSpinner.start("Creating template baseline");
    await createBaseline(cwd, repoDir, components, paths, vars, version, "init", componentSkips);
    baselineSpinner.stop("Baseline created.");

    const mergeSpinner = p.spinner();
    mergeSpinner.start("Merging baseline (preserving your code)");
    mergeBaseline(
      cwd,
      `projx: adopt template v${version} as baseline`,
      true,
      true,
    );
    mergeSpinner.stop("Baseline merged. Your code is preserved.");

    if (!existsSync(join(cwd, ".githooks"))) {
      try {
        execSync("git config core.hooksPath .githooks", { cwd, stdio: "pipe" });
        p.log.success("Git hooks configured.");
      } catch {
        p.log.warn("Failed to configure git hooks.");
      }
    }
  } finally {
    await cleanupRepo(repoDir, isLocal);
  }

  p.outro("Project initialized. Run './setup.sh' to install dependencies.\n\n  Like projx? Star it: https://github.com/ukanhaupa/projx");
}

async function confirmDetections(
  detected: DetectedComponent[],
): Promise<{ component: Component; directory: string }[]> {
  const confirmed: { component: Component; directory: string }[] = [];

  for (const d of detected) {
    const yes = await p.confirm({
      message: `Found ${LABELS[d.component].label} in ${d.directory}/ — register as "${d.component}"?`,
      initialValue: true,
    });

    if (p.isCancel(yes)) process.exit(0);
    if (yes) {
      confirmed.push({ component: d.component, directory: d.directory });
    }
  }

  return confirmed;
}

async function manualSelect(
  cwd: string,
): Promise<{ component: Component; directory: string }[]> {
  const selected = (await p.multiselect({
    message: "No components detected. Select manually:",
    options: COMPONENTS.map((c) => ({
      value: c,
      label: LABELS[c].label,
      hint: LABELS[c].hint,
    })),
    required: false,
  })) as Component[];

  if (p.isCancel(selected)) process.exit(0);

  const result: { component: Component; directory: string }[] = [];

  for (const component of selected) {
    const dir = (await p.text({
      message: `Directory for ${LABELS[component].label}?`,
      placeholder: component,
      defaultValue: component,
    })) as string;

    if (p.isCancel(dir)) process.exit(0);

    if (!existsSync(join(cwd, dir))) {
      p.log.warn(`${dir}/ does not exist — skipping.`);
      continue;
    }

    result.push({ component, directory: dir });
  }

  return result;
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
