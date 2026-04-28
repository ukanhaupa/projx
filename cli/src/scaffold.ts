import { copyFileSync, existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  type Component,
  type ComponentPaths,
  type Options,
  type PackageManager,
  cleanupRepo,
  downloadRepo,
  exec,
  hasCommand,
  pmCommands,
  toKebab,
} from "./utils.js";
import {
  applyTemplate,
  saveBaselineRef,
  type GeneratorVars,
} from "./baseline.js";
import { applyFeatures } from "./features.js";

export async function scaffold(
  opts: Options,
  dest: string,
  localRepo?: string,
): Promise<void> {
  const name = toKebab(opts.name);
  const pm: PackageManager = opts.packageManager ?? "npm";
  const paths = Object.fromEntries(
    opts.components.map((c) => [c, c]),
  ) as ComponentPaths;
  const vars: GeneratorVars = {
    projectName: name,
    components: opts.components,
    paths,
    pm: pmCommands(pm),
  };
  const isLocal = !!localRepo;

  await mkdir(dest, { recursive: true });

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
    const pkg = JSON.parse(
      await readFile(join(repoDir, "cli/package.json"), "utf-8"),
    );
    const version = pkg.version;

    p.log.info(`Scaffolding project in ${dest}`);

    if (opts.git) {
      exec("git init", dest);
    }

    const spinner = p.spinner();
    spinner.start("Scaffolding project");
    await applyTemplate(
      dest,
      repoDir,
      opts.components,
      paths,
      vars,
      version,
      undefined,
      undefined,
      true,
    );
    spinner.stop("Scaffold complete.");

    if (opts.features && Object.keys(opts.features).length > 0) {
      const featSpinner = p.spinner();
      featSpinner.start("Applying features");
      await applyFeatures({
        features: opts.features,
        repoDir,
        components: opts.components,
        instances: opts.components.map((type) => ({ type, path: type })),
        dest,
        vars,
      });
      featSpinner.stop("Features applied.");
    }

    if (opts.install) {
      await installDeps(dest, opts.components, pm);
    }

    copyEnvExamples(dest, opts.components);

    if (opts.git) {
      try {
        exec("git add -A", dest);
        exec('git commit -m "Initial scaffold from projx"', dest);
        exec("git config core.hooksPath .githooks", dest);
        saveBaselineRef(dest);
      } catch {
        // deps/env may add untracked files
      }
    }
  } finally {
    await cleanupRepo(repoDir, isLocal);
  }

  p.outro(
    `Done! Next steps:\n\n  cd ${name}\n  ./scripts/setup.sh\n\n  Like projx? Star it: https://github.com/ukanhaupa/projx`,
  );
}

async function installDeps(
  dest: string,
  components: Component[],
  pm: PackageManager,
): Promise<void> {
  const cmds = pmCommands(pm);
  const pmBin = pm === "bun" ? "bun" : pm;

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
          if (hasCommand(pmBin)) {
            spinner.start(`Installing Fastify dependencies (${cmds.install})`);
            exec(cmds.install, join(dest, "fastify"));
            spinner.stop("Fastify dependencies installed.");
          } else {
            p.log.warn(
              `${pm} not found — run 'cd fastify && ${cmds.install}' manually.`,
            );
          }
          break;
        case "frontend":
          if (hasCommand(pmBin)) {
            spinner.start(`Installing Frontend dependencies (${cmds.install})`);
            exec(cmds.install, join(dest, "frontend"));
            spinner.stop("Frontend dependencies installed.");
          } else {
            p.log.warn(
              `${pm} not found — run 'cd frontend && ${cmds.install}' manually.`,
            );
          }
          break;
        case "e2e":
          if (hasCommand(pmBin)) {
            spinner.start(`Installing E2E dependencies (${cmds.install})`);
            exec(cmds.install, join(dest, "e2e"));
            spinner.stop("E2E dependencies installed.");
          } else {
            p.log.warn(
              `${pm} not found — run 'cd e2e && ${cmds.install}' manually.`,
            );
          }
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
