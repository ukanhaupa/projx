import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  type Component,
  type ComponentPaths,
  cleanupRepo,
  copyComponent,
  discoverComponentPaths,
  downloadRepo,
  exec,
  hasCommand,
  replaceInDir,
  replaceInFile,
  toKebab,
  toSnake,
  writeComponentMarker,
} from "./utils.js";
import {
  generateDockerCompose,
  generateDockerComposeDev,
  generateCiYml,
  generatePreCommit,
  generateReadme,
  generateSetupSh,
} from "./generators/index.js";

interface ProjxConfig {
  version: string;
  components: Component[];
  createdAt: string;
  paths?: Record<string, string>;
  files?: string[];
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
    p.log.error("No .projx file found. Run 'projx <name>' to create a project first.");
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
    await doAdd(cwd, config, toAdd, repoDir, skipInstall);
  } finally {
    await cleanupRepo(repoDir, isLocal);
  }
}

async function doAdd(
  cwd: string,
  config: ProjxConfig,
  toAdd: Component[],
  repoDir: string,
  skipInstall: boolean,
): Promise<void> {
  const allComponents = [...config.components, ...toAdd] as Component[];
  const existingPaths = await discoverComponentPaths(cwd, config.components);
  const paths: ComponentPaths = { ...existingPaths };
  for (const c of toAdd) paths[c] = c;

  const name = detectProjectName(cwd, config.components, paths);
  const nameSnake = toSnake(name);
  const vars = { projectName: name, components: allComponents, paths };

  for (const component of toAdd) {
    const spinner = p.spinner();
    spinner.start(`Adding ${component}/`);
    await copyComponent(repoDir, component, cwd);
    await writeComponentMarker(join(cwd, component), component);
    spinner.stop(`${component}/`);
  }

  await substituteNames(cwd, toAdd, name, nameSnake);

  const spinner = p.spinner();
  spinner.start("Regenerating shared files");

  const hasBackend =
    allComponents.includes("fastapi") || allComponents.includes("fastify");

  if (hasBackend || allComponents.includes("frontend")) {
    await writeFile(join(cwd, "docker-compose.yml"), await generateDockerCompose(vars));
    await writeFile(join(cwd, "docker-compose.dev.yml"), await generateDockerComposeDev(vars));
  }

  await writeFile(join(cwd, "README.md"), await generateReadme(vars));

  await mkdir(join(cwd, ".githooks"), { recursive: true });
  await writeFile(join(cwd, ".githooks/pre-commit"), await generatePreCommit(vars));
  await chmod(join(cwd, ".githooks/pre-commit"), 0o755);

  await mkdir(join(cwd, ".github/workflows"), { recursive: true });
  await writeFile(join(cwd, ".github/workflows/ci.yml"), await generateCiYml(vars));

  await writeFile(join(cwd, "setup.sh"), await generateSetupSh(vars));
  await chmod(join(cwd, "setup.sh"), 0o755);

  spinner.stop("Shared files regenerated.");

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

  const pkg = JSON.parse(
    await readFile(join(repoDir, "cli/package.json"), "utf-8"),
  );
  const updatedConfig: ProjxConfig = {
    version: pkg.version,
    components: allComponents,
    createdAt: config.createdAt,
    paths,
  };
  await writeFile(join(cwd, ".projx"), JSON.stringify(updatedConfig, null, 2));

  p.outro(`Added ${toAdd.join(", ")}. Shared files updated for all ${allComponents.length} components.\n\n  Like projx? Star it: https://github.com/ukanhaupa/projx`);
}

async function substituteNames(
  dest: string,
  components: Component[],
  name: string,
  nameSnake: string,
): Promise<void> {
  if (components.includes("fastapi")) {
    await replaceInFile(
      join(dest, "fastapi/pyproject.toml"),
      "projx-fastapi",
      `${name}-fastapi`,
    );
  }
  if (components.includes("fastify")) {
    await replaceInFile(
      join(dest, "fastify/package.json"),
      "projx-fastify",
      `${name}-fastify`,
    );
  }
  if (components.includes("frontend")) {
    await replaceInFile(
      join(dest, "frontend/package.json"),
      "projx-frontend",
      `${name}-frontend`,
    );
  }
  if (components.includes("e2e")) {
    await replaceInFile(
      join(dest, "e2e/package.json"),
      "projx-e2e",
      `${name}-e2e`,
    );
  }
  if (components.includes("mobile")) {
    await replaceInFile(
      join(dest, "mobile/pubspec.yaml"),
      "projx_mobile",
      `${nameSnake}_mobile`,
    );
    await replaceInDir(
      join(dest, "mobile"),
      "package:projx_mobile/",
      `package:${nameSnake}_mobile/`,
      ".dart",
    );
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

function detectProjectName(
  cwd: string,
  components: Component[],
  paths: ComponentPaths,
): string {
  for (const component of components) {
    const dir = paths[component] ?? component;
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
