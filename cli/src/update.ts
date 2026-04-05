import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, mkdir, chmod, cp, rm } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  COMPONENTS,
  type Component,
  type ComponentPaths,
  cleanupRepo,
  copyComponent,
  discoverComponentPaths,
  downloadRepo,
  toKebab,
  toSnake,
  replaceInDir,
  writeComponentMarker,
} from "./utils.js";
import {
  generateDockerCompose,
  generateDockerComposeDev,
  generateCiYml,
  generatePreCommit,
  generateSetupSh,
  generateVscodeSettings,
} from "./generators/index.js";

interface ProjxConfig {
  version: string;
  components: Component[];
  createdAt: string;
  files?: string[];
}

const NEVER_OVERWRITE = [
  /\.env$/,
  /\.env\.(dev|staging|prod)$/,
  /prisma\/migrations\//,
  /src\/migrations\/versions\//,
  /\.projx-component$/,
];

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

function branchExists(cwd: string, branch: string): boolean {
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${branch}`, { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function getCurrentBranch(cwd: string): string {
  return execSync("git branch --show-current", { cwd, stdio: "pipe" }).toString().trim();
}

export async function update(cwd: string, localRepo?: string): Promise<void> {
  p.intro("projx update");
  const isLocal = !!localRepo;

  const configPath = join(cwd, ".projx");
  let config: ProjxConfig;

  if (existsSync(configPath)) {
    config = JSON.parse(await readFile(configPath, "utf-8"));
    p.log.info(
      `Found .projx (v${config.version}, components: ${config.components.join(", ")})`,
    );
  } else {
    p.log.warn("No .projx file found. Detecting components from directories.");
    const detected = COMPONENTS.filter((c) =>
      existsSync(join(cwd, c)),
    ) as Component[];
    if (detected.length === 0) {
      p.log.error("No projx components found in this directory.");
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

  const useGitBranch = isGitRepo(cwd);
  let branchName: string;
  let originalBranch: string;

  if (useGitBranch) {
    if (hasUncommittedChanges(cwd)) {
      p.log.error("You have uncommitted changes. Commit or stash them first.");
      process.exit(1);
    }

    originalBranch = getCurrentBranch(cwd);

    const dlSpinner = p.spinner();
    dlSpinner.start(isLocal ? "Using local templates" : "Downloading latest templates");
    const repoDir = await downloadRepo(localRepo).catch((err) => {
      dlSpinner.stop("Failed.");
      p.log.error(String(err));
      process.exit(1);
    });
    dlSpinner.stop(isLocal ? "Local templates loaded." : "Templates downloaded.");

    const pkg = JSON.parse(
      await readFile(join(repoDir, "cli/package.json"), "utf-8"),
    );
    branchName = `projx/update-v${pkg.version}`;

    if (branchExists(cwd, branchName)) {
      let suffix = 1;
      while (branchExists(cwd, `${branchName}-${suffix}`)) suffix++;
      branchName = `${branchName}-${suffix}`;
    }

    execSync(`git checkout -b ${branchName}`, { cwd, stdio: "pipe" });
    p.log.info(`Created branch: ${branchName}`);

    let touchedFiles: string[];
    try {
      touchedFiles = await doUpdate(cwd, config, repoDir, pkg.version, componentPaths);
    } finally {
      await cleanupRepo(repoDir, isLocal);
    }

    for (const f of touchedFiles) {
      execSync(`git add "${f}"`, { cwd, stdio: "pipe" });
    }
    execSync(`git commit --no-verify -m "projx update to v${pkg.version}"`, { cwd, stdio: "pipe" });

    p.outro(
      `Updated on branch: ${branchName}\n\n` +
      `  Review changes:\n` +
      `    git diff ${originalBranch}...${branchName}\n\n` +
      `  Merge (resolve conflicts for files you customized):\n` +
      `    git checkout ${originalBranch} && git merge --no-ff ${branchName}`
    );
  } else {
    const dlSpinner = p.spinner();
    dlSpinner.start(isLocal ? "Using local templates" : "Downloading latest templates");
    const repoDir = await downloadRepo(localRepo).catch((err) => {
      dlSpinner.stop("Failed.");
      p.log.error(String(err));
      process.exit(1);
    });
    dlSpinner.stop(isLocal ? "Local templates loaded." : "Templates downloaded.");

    const pkg = JSON.parse(
      await readFile(join(repoDir, "cli/package.json"), "utf-8"),
    );

    try {
      await doUpdate(cwd, config, repoDir, pkg.version, componentPaths);
    } finally {
      await cleanupRepo(repoDir, isLocal);
    }

    p.outro(`Updated to v${pkg.version}. Review changes before committing.`);
  }
}

async function doUpdate(
  cwd: string,
  config: ProjxConfig,
  repoDir: string,
  version: string,
  componentPaths: ComponentPaths,
): Promise<string[]> {
  const name = detectProjectName(cwd, config.components, componentPaths);
  const nameSnake = toSnake(name);
  const vars = { projectName: name, components: config.components, paths: componentPaths };
  const touchedFiles: string[] = [];
  const usedPaths = new Set<string>();

  for (const component of config.components) {
    const targetDir = componentPaths[component];

    if (usedPaths.has(targetDir)) {
      p.log.warn(`${component} shares directory ${targetDir}/ with another component — skipping overlay to avoid nesting.`);
      continue;
    }
    usedPaths.add(targetDir);

    const spinner = p.spinner();
    spinner.start(`Updating ${targetDir}/ (${component})`);

    const componentSrc = join(repoDir, component);
    if (!existsSync(componentSrc)) {
      spinner.stop(`${component} template not found, skipping.`);
      continue;
    }

    const tmpDest = join(cwd, `.projx-tmp`);
    const files = await copyComponent(repoDir, component, tmpDest);

    for (const file of files) {
      const src = join(tmpDest, component, file);
      const destRel = `${targetDir}/${file}`;
      const dest = join(cwd, destRel);

      if (NEVER_OVERWRITE.some((re) => re.test(destRel))) continue;

      const dir = dest.substring(0, dest.lastIndexOf("/"));
      await mkdir(dir, { recursive: true });

      await cp(src, dest, { force: true });
      touchedFiles.push(destRel);
    }

    await rm(tmpDest, { recursive: true, force: true });

    if (!existsSync(join(cwd, targetDir, ".projx-component"))) {
      await writeComponentMarker(join(cwd, targetDir), component);
      touchedFiles.push(`${targetDir}/.projx-component`);
    }

    spinner.stop(`${targetDir}/ updated.`);
  }

  const spinner = p.spinner();
  spinner.start("Updating shared files");

  const hasBackend =
    config.components.includes("fastapi") ||
    config.components.includes("fastify");

  if (hasBackend || config.components.includes("frontend")) {
    await writeFile(join(cwd, "docker-compose.yml"), await generateDockerCompose(vars));
    touchedFiles.push("docker-compose.yml");
    await writeFile(join(cwd, "docker-compose.dev.yml"), await generateDockerComposeDev(vars));
    touchedFiles.push("docker-compose.dev.yml");
  }

  await mkdir(join(cwd, ".githooks"), { recursive: true });
  await writeFile(join(cwd, ".githooks/pre-commit"), await generatePreCommit(vars));
  await chmod(join(cwd, ".githooks/pre-commit"), 0o755);
  touchedFiles.push(".githooks/pre-commit");

  await mkdir(join(cwd, ".github/workflows"), { recursive: true });
  await writeFile(join(cwd, ".github/workflows/ci.yml"), await generateCiYml(vars));
  touchedFiles.push(".github/workflows/ci.yml");

  await writeFile(join(cwd, "setup.sh"), await generateSetupSh(vars));
  await chmod(join(cwd, "setup.sh"), 0o755);
  touchedFiles.push("setup.sh");

  await mkdir(join(cwd, ".vscode"), { recursive: true });
  await writeFile(join(cwd, ".vscode/settings.json"), generateVscodeSettings(vars));
  touchedFiles.push(".vscode/settings.json");

  spinner.stop("Shared files updated.");

  if (config.components.includes("mobile")) {
    const mobilePath = componentPaths.mobile ?? "mobile";
    await replaceInDir(
      join(cwd, mobilePath),
      "package:projx_mobile/",
      `package:${nameSnake}_mobile/`,
      ".dart",
    );
  }

  const updatedConfig: ProjxConfig = {
    version,
    components: config.components,
    createdAt: config.createdAt,
  };
  await writeFile(join(cwd, ".projx"), JSON.stringify(updatedConfig, null, 2));
  touchedFiles.push(".projx");

  return touchedFiles;
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
        const pkg = JSON.parse(
          readFileSync(pkgPath, "utf-8"),
        );
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

