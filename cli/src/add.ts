import { copyFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  type Component,
  type ComponentPaths,
  cleanupRepo,
  detectProjectName,
  discoverComponentPaths,
  downloadRepo,
  exec,
  hasCommand,
} from "./utils.js";
import { writeTemplateToDir, type GeneratorVars } from "./baseline.js";

interface ProjxConfig {
  version: string;
  components: Component[];
  createdAt: string;
}

export async function add(
  cwd: string,
  newComponents: Component[],
  localRepo?: string,
  skipInstall = false,
): Promise<void> {
  p.intro("projx add");
  const isLocal = !!localRepo;

  const configPath = join(cwd, ".projx");
  if (!existsSync(configPath)) {
    p.log.error("No .projx file found. Run 'npx create-projx <name>' to create a project first.");
    process.exit(1);
  }

  const config: ProjxConfig = JSON.parse(await readFile(configPath, "utf-8"));
  const existing = config.components;

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
  dlSpinner.start(isLocal ? "Using local templates" : "Downloading latest templates");
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

    const name = detectProjectName(cwd, existing, paths);
    const vars: GeneratorVars = { projectName: name, components: allComponents, paths };

    const pkg = JSON.parse(await readFile(join(repoDir, "cli/package.json"), "utf-8"));
    const version = pkg.version;

    const spinner = p.spinner();
    spinner.start("Adding components");
    await writeTemplateToDir(cwd, repoDir, allComponents, paths, vars, version, "scaffold");
    spinner.stop("Components added.");

    if (!skipInstall) {
      await installDeps(cwd, toAdd);
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

    p.outro(`Added ${toAdd.join(", ")}.\n\n  Like projx? Star it: https://github.com/ukanhaupa/projx`);
  } finally {
    await cleanupRepo(repoDir, isLocal);
  }
}

async function installDeps(
  dest: string,
  components: Component[],
): Promise<void> {
  for (const component of components) {
    const spinner = p.spinner();
    try {
      switch (component) {
        case "fastapi":
          if (hasCommand("uv")) {
            spinner.start("Installing FastAPI dependencies");
            exec("uv sync --all-extras", join(dest, "fastapi"));
            spinner.stop("FastAPI dependencies installed.");
          } else {
            p.log.warn("uv not found — run 'cd fastapi && uv sync' manually.");
          }
          break;
        case "fastify":
          if (hasCommand("pnpm")) {
            spinner.start("Installing Fastify dependencies");
            exec("pnpm install", join(dest, "fastify"));
            spinner.stop("Fastify dependencies installed.");
          } else {
            spinner.start("Installing Fastify dependencies");
            exec("npm install", join(dest, "fastify"));
            spinner.stop("Fastify dependencies installed.");
          }
          break;
        case "frontend":
          spinner.start("Installing Frontend dependencies");
          exec("npm install", join(dest, "frontend"));
          spinner.stop("Frontend dependencies installed.");
          break;
        case "e2e":
          spinner.start("Installing E2E dependencies");
          exec("npm install", join(dest, "e2e"));
          spinner.stop("E2E dependencies installed.");
          break;
        case "mobile":
          if (hasCommand("flutter")) {
            spinner.start("Installing Flutter dependencies");
            exec("flutter pub get", join(dest, "mobile"));
            spinner.stop("Flutter dependencies installed.");
          } else {
            p.log.warn("Flutter not found — run 'cd mobile && flutter pub get' manually.");
          }
          break;
        case "infra":
          break;
      }
    } catch {
      spinner.stop(`Failed to install ${component} dependencies.`);
    }
  }
}

