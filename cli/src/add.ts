import { copyFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  type Component,
  type ComponentInstance,
  type ComponentPaths,
  type PackageManager,
  cleanupRepo,
  detectProjectName,
  discoverComponentPaths,
  discoverComponentsFromMarkers,
  downloadRepo,
  exec,
  hasCommand,
  pmCommands,
  readComponentMarker,
  readProjxConfig,
} from "./utils.js";
import {
  applyTemplate,
  writeTemplateToDir,
  type GeneratorVars,
} from "./baseline.js";

export async function add(
  cwd: string,
  newComponents: Component[],
  localRepo?: string,
  skipInstall = false,
  customName?: string,
): Promise<void> {
  p.intro("projx add");
  const isLocal = !!localRepo;

  if (!existsSync(join(cwd, ".projx"))) {
    p.log.error(
      "No .projx file found. Run 'npx create-projx <name>' to create a project first.",
    );
    process.exit(1);
  }

  const config = await readProjxConfig(cwd);
  const { components: existing } = await discoverComponentsFromMarkers(cwd);

  if (customName) {
    if (newComponents.length !== 1) {
      throw new Error(
        "--name can only be used when adding a single component type.",
      );
    }
    const targetDir = join(cwd, customName);
    if (existsSync(targetDir)) {
      throw new Error(`Directory '${customName}' already exists.`);
    }
    return await addInstance(
      cwd,
      newComponents[0],
      customName,
      config,
      existing,
      localRepo,
      skipInstall,
      isLocal,
    );
  }

  const alreadyExists = newComponents.filter((c) => existing.includes(c));
  if (alreadyExists.length > 0) {
    p.log.warn(`Already present: ${alreadyExists.join(", ")}. Skipping those.`);
  }

  const toAdd = newComponents.filter((c) => !existing.includes(c));
  if (toAdd.length === 0) {
    p.log.info("Nothing new to add.");
    process.exit(0);
  }

  p.log.info(`Adding: ${toAdd.join(", ")}`);

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
    const allComponents = [...existing, ...toAdd] as Component[];
    const existingPaths = await discoverComponentPaths(cwd, existing);
    const paths: ComponentPaths = { ...existingPaths };
    for (const c of toAdd) paths[c] = c;

    const { instances: existingInstances } =
      await discoverComponentsFromMarkers(cwd);
    const instances: ComponentInstance[] = [
      ...existingInstances,
      ...toAdd.map((c) => ({ type: c, path: c })),
    ];

    const pm: PackageManager =
      (config.packageManager as PackageManager) ?? "npm";
    const name = detectProjectName(cwd, existing, paths);
    const vars: GeneratorVars = {
      projectName: name,
      components: allComponents,
      paths,
      instances,
      pm: pmCommands(pm),
      orm: config.orm ?? "prisma",
    };

    const pkg = JSON.parse(
      await readFile(join(repoDir, "cli/package.json"), "utf-8"),
    );
    const version = pkg.version;

    const spinner = p.spinner();
    spinner.start("Adding components");
    await writeTemplateToDir(
      cwd,
      repoDir,
      allComponents,
      paths,
      vars,
      version,
      { realCwd: cwd },
    );
    spinner.stop("Components added.");

    if (!skipInstall) {
      await installDeps(
        cwd,
        toAdd.map((c) => ({ type: c, path: c })),
        pm,
      );
    }

    for (const component of toAdd) {
      const example = join(cwd, component, ".env.example");
      const env = join(cwd, component, ".env");
      if (existsSync(example) && !existsSync(env)) {
        try {
          copyFileSync(example, env);
        } catch {
          // non-critical
        }
      }
    }

    p.outro(
      `Added ${toAdd.join(", ")}.\n\n  Like projx? Star it: https://github.com/ukanhaupa/projx`,
    );
  } finally {
    await cleanupRepo(repoDir, isLocal);
  }
}

async function addInstance(
  cwd: string,
  type: Component,
  customName: string,
  config: Awaited<ReturnType<typeof readProjxConfig>>,
  existing: Component[],
  localRepo: string | undefined,
  skipInstall: boolean,
  isLocal: boolean,
): Promise<void> {
  p.log.info(`Adding ${type} instance at ${customName}/`);

  const dlSpinner = p.spinner();
  dlSpinner.start(
    isLocal ? "Using local templates" : "Downloading latest templates",
  );
  const repoDir = await downloadRepo(localRepo).catch((err) => {
    dlSpinner.stop("Failed.");
    throw err;
  });
  dlSpinner.stop(isLocal ? "Local templates loaded." : "Templates downloaded.");

  try {
    const existingPaths = await discoverComponentPaths(cwd, existing);
    const paths: ComponentPaths = { ...existingPaths };

    const { instances: existingInstances } =
      await discoverComponentsFromMarkers(cwd);
    const newInstance: ComponentInstance = { type, path: customName };
    const instances: ComponentInstance[] = [...existingInstances, newInstance];

    const pm: PackageManager =
      (config.packageManager as PackageManager) ?? "npm";
    const name = detectProjectName(cwd, existing, existingPaths);
    const vars: GeneratorVars = {
      projectName: name,
      components: existing,
      paths,
      instances,
      pm: pmCommands(pm),
      orm: config.orm ?? "prisma",
    };

    const pkg = JSON.parse(
      await readFile(join(repoDir, "cli/package.json"), "utf-8"),
    );
    const version = pkg.version;
    const INSTANCE_AWARE_ROOT = new Set([
      ".github/workflows/ci.yml",
      ".githooks/pre-commit",
      "scripts/setup.sh",
      "docker-compose.yml",
    ]);
    const rawSkip: string[] = Array.isArray(config.skip)
      ? (config.skip as string[])
      : [];
    const rootSkip = rawSkip.filter((p) => !INSTANCE_AWARE_ROOT.has(p));
    const componentSkips: Record<string, string[]> = {};
    for (const inst of existingInstances) {
      const m = await readComponentMarker(join(cwd, inst.path));
      if (m?.skip && m.skip.length > 0) componentSkips[inst.type] = m.skip;
    }

    const spinner = p.spinner();
    spinner.start(`Scaffolding ${customName}/`);
    const result = await applyTemplate(
      cwd,
      repoDir,
      existing,
      paths,
      vars,
      version,
      componentSkips,
      rootSkip,
      false,
      [newInstance],
      [newInstance],
    );
    spinner.stop(`Scaffolded ${customName}/.`);

    if (result.status === "merged") {
      p.log.success(
        `${result.mergedFiles?.length ?? 0} root file(s) merged cleanly.`,
      );
    } else if (result.status === "conflicts") {
      const conflictCount = result.conflictedFiles?.length ?? 0;
      if (conflictCount > 0) {
        p.log.warn(`${conflictCount} root file(s) need manual review:`);
        for (const f of result.conflictedFiles!) p.log.info(`  ${f}`);
        p.log.info("Review:  git diff");
        p.log.info("Keep:    git add <file>");
        p.log.info("Discard: git checkout -- <file>");
      }
    }

    if (!skipInstall) {
      await installDeps(cwd, [{ type, path: customName }], pm);
    }

    const example = join(cwd, customName, ".env.example");
    const env = join(cwd, customName, ".env");
    if (existsSync(example) && !existsSync(env)) {
      try {
        copyFileSync(example, env);
      } catch {
        // non-critical
      }
    }

    p.outro(`Added ${type} instance at ${customName}/.`);
  } finally {
    await cleanupRepo(repoDir, isLocal);
  }
}

async function installDeps(
  dest: string,
  instances: ComponentInstance[],
  pm: PackageManager,
): Promise<void> {
  const cmds = pmCommands(pm);
  const pmBin = pm === "bun" ? "bun" : pm;

  for (const { type, path } of instances) {
    const dir = join(dest, path);
    const spinner = p.spinner();
    try {
      switch (type) {
        case "fastapi":
          if (hasCommand("uv")) {
            spinner.start(`Installing FastAPI dependencies (${path}/)`);
            exec("uv sync --all-extras", dir);
            spinner.stop(`FastAPI dependencies installed (${path}/).`);
          } else {
            p.log.warn(`uv not found — run 'cd ${path} && uv sync' manually.`);
          }
          break;
        case "fastify":
          if (hasCommand(pmBin)) {
            spinner.start(
              `Installing Fastify dependencies (${path}/, ${cmds.install})`,
            );
            exec(cmds.install, dir);
            spinner.stop(`Fastify dependencies installed (${path}/).`);
          } else {
            p.log.warn(
              `${pm} not found — run 'cd ${path} && ${cmds.install}' manually.`,
            );
          }
          break;
        case "express":
          if (hasCommand(pmBin)) {
            spinner.start(
              `Installing Express dependencies (${path}/, ${cmds.install})`,
            );
            exec(cmds.install, dir);
            spinner.stop(`Express dependencies installed (${path}/).`);
          } else {
            p.log.warn(
              `${pm} not found — run 'cd ${path} && ${cmds.install}' manually.`,
            );
          }
          break;
        case "frontend":
          if (hasCommand(pmBin)) {
            spinner.start(
              `Installing Frontend dependencies (${path}/, ${cmds.install})`,
            );
            exec(cmds.install, dir);
            spinner.stop(`Frontend dependencies installed (${path}/).`);
          } else {
            p.log.warn(
              `${pm} not found — run 'cd ${path} && ${cmds.install}' manually.`,
            );
          }
          break;
        case "e2e":
          if (hasCommand(pmBin)) {
            spinner.start(
              `Installing E2E dependencies (${path}/, ${cmds.install})`,
            );
            exec(cmds.install, dir);
            spinner.stop(`E2E dependencies installed (${path}/).`);
          } else {
            p.log.warn(
              `${pm} not found — run 'cd ${path} && ${cmds.install}' manually.`,
            );
          }
          break;
        case "mobile":
          if (hasCommand("flutter")) {
            spinner.start(`Installing Flutter dependencies (${path}/)`);
            exec("flutter pub get", dir);
            spinner.stop(`Flutter dependencies installed (${path}/).`);
          } else {
            p.log.warn(
              `Flutter not found — run 'cd ${path} && flutter pub get' manually.`,
            );
          }
          break;
        case "infra":
          break;
      }
    } catch {
      spinner.stop(`Failed to install ${type} dependencies (${path}/).`);
    }
  }
}
