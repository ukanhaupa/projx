import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  COMPONENTS,
  type Component,
  type ComponentPaths,
  type PackageManager,
  PACKAGE_MANAGERS,
  cleanupRepo,
  detectPackageManager,
  downloadRepo,
  pmCommands,
  toKebab,
} from "./utils.js";
import { LABELS } from "./prompts.js";
import { detectComponents, type DetectedComponent } from "./detect.js";
import { applyTemplate, saveBaselineRef, type GeneratorVars } from "./baseline.js";

export async function init(
  cwd: string,
  localRepo?: string,
): Promise<void> {
  p.intro("projx init");
  const isLocal = !!localRepo;

  if (existsSync(join(cwd, ".projx"))) {
    p.log.error("This project is already initialized. Use 'npx create-projx update' or 'npx create-projx add' instead.");
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

  const hasJs = components.some((c) => ["fastify", "frontend", "e2e"].includes(c));
  let pm: PackageManager = "npm";

  if (hasJs) {
    const detected = detectPackageManager(cwd);
    if (detected) {
      pm = detected;
      p.log.info(`Detected package manager: ${pm}`);
    } else if (process.stdin.isTTY) {
      const choice = (await p.select({
        message: "Package manager",
        options: PACKAGE_MANAGERS.map((v) => ({ value: v, label: v })),
        initialValue: "npm" as PackageManager,
      })) as PackageManager | symbol;
      if (p.isCancel(choice)) process.exit(0);
      pm = choice as PackageManager;
    }
  }

  const projectName = toKebab(cwd.split("/").pop()!);
  const vars: GeneratorVars = { projectName, components, paths, pm: pmCommands(pm) };

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

    const applySpinner = p.spinner();
    applySpinner.start("Applying template");
    const result = await applyTemplate(cwd, repoDir, components, paths, vars, version, undefined, undefined, true);
    applySpinner.stop("Template applied.");

    if (existsSync(join(cwd, ".githooks"))) {
      try {
        execSync("git config core.hooksPath .githooks", { cwd, stdio: "pipe" });
      } catch {
        // non-critical
      }
    }

    if (result.status === "clean" || result.status === "merged") {
      saveBaselineRef(cwd);
    }

    if (result.status === "conflicts") {
      p.log.warn("Some template files differ from your code. Changes written directly.");
      p.log.info("Review changes:");
      p.log.info("  git diff");
      p.log.info("");
      p.log.info("Keep a change:  git add <file>");
      p.log.info("Discard a change:  git checkout -- <file>");
      p.log.info("Commit when ready:  git add . && git commit -m \"projx: init\"");
      p.log.info("");
      p.log.info("To skip files on future updates, add to .projx-component:");
      p.log.info('  { "skip": ["src/**", "tests/**"] }');
      p.outro("Template applied. Review with git diff.\n\n  Like projx? Star it: https://github.com/ukanhaupa/projx");
    } else {
      p.outro("Project initialized.\n\n  Like projx? Star it: https://github.com/ukanhaupa/projx");
    }
  } finally {
    await cleanupRepo(repoDir, isLocal);
  }
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
