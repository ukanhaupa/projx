import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, chmod, cp } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  COMPONENTS,
  type Component,
  type ComponentPaths,
  cleanupRepo,
  downloadRepo,
  readFileOrNull,
  toKebab,
  writeComponentMarker,
} from "./utils.js";
import { LABELS } from "./prompts.js";
import { detectComponents, type DetectedComponent } from "./detect.js";
import { unifiedDiff } from "./diff.js";
import {
  generateDockerCompose,
  generateDockerComposeDev,
  generateCiYml,
  generatePreCommit,
  generateReadme,
  generateSetupSh,
  generateVscodeSettings,
} from "./generators/index.js";

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
  const vars = { projectName, components, paths };

  const dlSpinner = p.spinner();
  dlSpinner.start(isLocal ? "Using local templates" : "Downloading latest templates");
  const repoDir = await downloadRepo(localRepo).catch((err) => {
    dlSpinner.stop("Failed.");
    p.log.error(String(err));
    process.exit(1);
  });
  dlSpinner.stop(isLocal ? "Local templates loaded." : "Templates downloaded.");

  try {
    for (const { component, directory } of confirmed) {
      const dir = join(cwd, directory);
      if (existsSync(dir)) {
        await writeComponentMarker(dir, component);
        p.log.success(`${directory}/.projx-component`);
      }
    }

    await generateSharedFiles(cwd, repoDir, vars);

    const pkg = JSON.parse(
      await readFile(join(repoDir, "cli/package.json"), "utf-8"),
    );
    const projxConfig = {
      version: pkg.version,
      components,
      createdAt: new Date().toISOString().split("T")[0],
    };
    await writeFile(join(cwd, ".projx"), JSON.stringify(projxConfig, null, 2));
    p.log.success(".projx");

    if (isGitRepo(cwd)) {
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

interface SharedFile {
  path: string;
  content: string;
  mode?: number;
}

async function generateSharedFiles(
  cwd: string,
  repoDir: string,
  vars: { projectName: string; components: Component[]; paths: ComponentPaths },
): Promise<void> {
  const files: SharedFile[] = [];

  const hasBackend =
    vars.components.includes("fastapi") ||
    vars.components.includes("fastify");

  if (hasBackend || vars.components.includes("frontend")) {
    files.push(
      { path: "docker-compose.yml", content: await generateDockerCompose(vars) },
      { path: "docker-compose.dev.yml", content: await generateDockerComposeDev(vars) },
    );
  }

  files.push(
    { path: "README.md", content: await generateReadme(vars) },
    { path: ".githooks/pre-commit", content: await generatePreCommit(vars), mode: 0o755 },
    { path: ".github/workflows/ci.yml", content: await generateCiYml(vars) },
    { path: "setup.sh", content: await generateSetupSh(vars), mode: 0o755 },
  );

  for (const file of files) {
    const dest = join(cwd, file.path);
    const dir = dest.substring(0, dest.lastIndexOf("/"));
    if (dir !== cwd) await mkdir(dir, { recursive: true });

    const existing = await readFileOrNull(dest);

    if (existing === null) {
      await writeFile(dest, file.content);
      if (file.mode) await chmod(dest, file.mode);
      p.log.success(file.path);
    } else if (existing === file.content) {
      p.log.info(`${file.path} — identical, skipped.`);
    } else {
      const action = await resolveConflict(file.path, existing, file.content);
      if (action === "overwrite") {
        await writeFile(dest, file.content);
        if (file.mode) await chmod(dest, file.mode);
        p.log.success(`${file.path} — overwritten.`);
      } else {
        p.log.info(`${file.path} — kept existing.`);
      }
    }
  }

  const statics = [".editorconfig"];
  for (const file of statics) {
    const src = join(repoDir, file);
    const dest = join(cwd, file);
    if (!existsSync(src)) continue;

    if (!existsSync(dest)) {
      await cp(src, dest);
      p.log.success(file);
    } else {
      const existing = await readFileOrNull(dest);
      const template = await readFileOrNull(src);
      if (existing === template) {
        p.log.info(`${file} — identical, skipped.`);
      } else {
        const action = await resolveConflict(file, existing ?? "", template ?? "");
        if (action === "overwrite") {
          await cp(src, dest, { force: true });
          p.log.success(`${file} — overwritten.`);
        } else {
          p.log.info(`${file} — kept existing.`);
        }
      }
    }
  }

  const vscodeDest = join(cwd, ".vscode");
  await mkdir(vscodeDest, { recursive: true });

  const settingsPath = join(vscodeDest, "settings.json");
  const settingsContent = generateVscodeSettings(vars);
  const existingSettings = await readFileOrNull(settingsPath);
  if (existingSettings === null) {
    await writeFile(settingsPath, settingsContent);
    p.log.success(".vscode/settings.json");
  } else if (existingSettings !== settingsContent) {
    const action = await resolveConflict(".vscode/settings.json", existingSettings, settingsContent);
    if (action === "overwrite") {
      await writeFile(settingsPath, settingsContent);
      p.log.success(".vscode/settings.json — overwritten.");
    } else {
      p.log.info(".vscode/settings.json — kept existing.");
    }
  }

  const extSrc = join(repoDir, ".vscode/extensions.json");
  const extDest = join(vscodeDest, "extensions.json");
  if (existsSync(extSrc) && !existsSync(extDest)) {
    await cp(extSrc, extDest);
    p.log.success(".vscode/extensions.json");
  }
}

async function resolveConflict(
  filePath: string,
  existing: string,
  template: string,
): Promise<"overwrite" | "skip"> {
  let action = (await p.select({
    message: `${filePath} differs from projx template`,
    options: [
      { value: "diff", label: "View diff" },
      { value: "overwrite", label: "Overwrite with template" },
      { value: "skip", label: "Skip (keep existing)" },
    ],
  })) as "diff" | "overwrite" | "skip";

  if (p.isCancel(action)) process.exit(0);

  if (action === "diff") {
    const diff = unifiedDiff(existing, template, filePath);
    p.log.message(diff);

    action = (await p.select({
      message: `${filePath}`,
      options: [
        { value: "overwrite", label: "Overwrite with template" },
        { value: "skip", label: "Skip (keep existing)" },
      ],
    })) as "overwrite" | "skip";

    if (p.isCancel(action)) process.exit(0);
  }

  return action;
}

function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
