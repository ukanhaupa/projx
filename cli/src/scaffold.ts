import { copyFileSync, existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  type Component,
  type ComponentPaths,
  type Options,
  cleanupRepo,
  copyComponent,
  copyStaticFiles,
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
  generateVscodeSettings,
} from "./generators/index.js";

export async function scaffold(opts: Options, dest: string, localRepo?: string): Promise<void> {
  const name = toKebab(opts.name);
  const nameSnake = toSnake(opts.name);
  const paths = Object.fromEntries(
    opts.components.map((c) => [c, c]),
  ) as ComponentPaths;
  const vars = { projectName: name, components: opts.components, paths };
  const isLocal = !!localRepo;

  await mkdir(dest, { recursive: true });

  const dlSpinner = p.spinner();
  dlSpinner.start(isLocal ? "Using local templates" : "Downloading latest templates");
  const repoDir = await downloadRepo(localRepo).catch((err) => {
    dlSpinner.stop("Failed.");
    p.log.error(String(err));
    process.exit(1);
  });
  dlSpinner.stop(isLocal ? "Local templates loaded." : "Templates downloaded.");

  try {
    await doScaffold(opts, dest, repoDir, name, nameSnake, vars);
  } finally {
    await cleanupRepo(repoDir, isLocal);
  }
}

async function doScaffold(
  opts: Options,
  dest: string,
  repoDir: string,
  name: string,
  nameSnake: string,
  vars: { projectName: string; components: Component[]; paths: ComponentPaths },
): Promise<void> {
  p.log.info(`Scaffolding project in ${dest}`);

  for (const component of opts.components) {
    const spinner = p.spinner();
    spinner.start(`Copying ${component}/`);
    await copyComponent(repoDir, component, dest);
    await writeComponentMarker(join(dest, component), component);
    spinner.stop(`${component}/`);
  }

  await substituteNames(dest, opts.components, name, nameSnake);

  const hasBackend =
    opts.components.includes("fastapi") ||
    opts.components.includes("fastify");

  if (hasBackend || opts.components.includes("frontend")) {
    await writeFile(join(dest, "docker-compose.yml"), await generateDockerCompose(vars));
    await writeFile(join(dest, "docker-compose.dev.yml"), await generateDockerComposeDev(vars));
  }

  await writeFile(join(dest, "README.md"), await generateReadme(vars));

  await mkdir(join(dest, ".githooks"), { recursive: true });
  await writeFile(join(dest, ".githooks/pre-commit"), await generatePreCommit(vars));
  await chmod(join(dest, ".githooks/pre-commit"), 0o755);

  await mkdir(join(dest, ".github/workflows"), { recursive: true });
  await writeFile(join(dest, ".github/workflows/ci.yml"), await generateCiYml(vars));

  await writeFile(join(dest, "setup.sh"), await generateSetupSh(vars));
  await chmod(join(dest, "setup.sh"), 0o755);

  await copyStaticFiles(repoDir, dest);

  await mkdir(join(dest, ".vscode"), { recursive: true });
  await writeFile(join(dest, ".vscode/settings.json"), generateVscodeSettings(vars));

  const pkg = JSON.parse(
    await readFile(join(repoDir, "cli/package.json"), "utf-8"),
  );
  const projxConfig = {
    version: pkg.version,
    components: opts.components,
    createdAt: new Date().toISOString().split("T")[0],
    paths: vars.paths,
  };
  await writeFile(join(dest, ".projx"), JSON.stringify(projxConfig, null, 2));

  if (opts.git) {
    try {
      exec("git init", dest);
      exec("git config core.hooksPath .githooks", dest);
      p.log.success("Git initialized with hooks.");
    } catch {
      p.log.warn("Failed to initialize git.");
    }
  }

  if (opts.install) {
    await installDeps(dest, opts.components);
  }

  copyEnvExamples(dest, opts.components);

  if (opts.git) {
    try {
      exec("git add -A", dest);
      exec('git commit -m "Initial scaffold from projx"', dest);
      p.log.success("Initial commit created.");
    } catch {
      // pre-commit hooks may fail if tools not installed
    }
  }

  p.outro(`Done! Next steps:\n\n  cd ${name}\n  ./setup.sh\n\n  Like projx? Star it: https://github.com/ukanhaupa/projx`);
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
            spinner.start("Installing FastAPI dependencies (uv sync)");
            exec("uv sync --all-extras", join(dest, "fastapi"));
            spinner.stop("FastAPI dependencies installed.");
          } else {
            p.log.warn("uv not found — run 'cd fastapi && uv sync' manually.");
          }
          break;
        case "fastify":
          if (hasCommand("pnpm")) {
            spinner.start("Installing Fastify dependencies (pnpm install)");
            exec("pnpm install", join(dest, "fastify"));
            spinner.stop("Fastify dependencies installed.");
          } else {
            spinner.start("Installing Fastify dependencies (npm install)");
            exec("npm install", join(dest, "fastify"));
            spinner.stop("Fastify dependencies installed.");
          }
          break;
        case "frontend":
          spinner.start("Installing Frontend dependencies (npm install)");
          exec("npm install", join(dest, "frontend"));
          spinner.stop("Frontend dependencies installed.");
          break;
        case "e2e":
          spinner.start("Installing E2E dependencies (npm install)");
          exec("npm install", join(dest, "e2e"));
          spinner.stop("E2E dependencies installed.");
          break;
        case "mobile":
          if (hasCommand("flutter")) {
            spinner.start("Installing Flutter dependencies");
            exec("flutter pub get", join(dest, "mobile"));
            spinner.stop("Flutter dependencies installed.");
          } else {
            p.log.warn(
              "Flutter not found — run 'cd mobile && flutter pub get' manually.",
            );
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

function copyEnvExamples(dest: string, components: Component[]): void {
  for (const component of components) {
    const example = join(dest, component, ".env.example");
    const env = join(dest, component, ".env");
    if (existsSync(example) && !existsSync(env)) {
      try {
        copyFileSync(example, env);
      } catch {
        // non-critical
      }
    }
  }
}
