import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  render,
  sharedTemplateDir,
  type Component,
  type ComponentInstance,
  type ComponentPaths,
} from "../utils.js";

interface GeneratorVars {
  projectName: string;
  components: Component[];
  paths: ComponentPaths;
  instances?: ComponentInstance[];
  [key: string]: unknown;
}

function shellSafeUpper(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

const CANONICAL_DISPLAY: Record<Component, string> = {
  fastapi: "FastAPI",
  fastify: "Fastify",
  frontend: "Frontend",
  mobile: "Flutter",
  e2e: "E2E",
  infra: "Terraform",
};

function withInstances(vars: GeneratorVars): GeneratorVars {
  const base: ComponentInstance[] =
    vars.instances && vars.instances.length > 0
      ? vars.instances
      : vars.components.map((type) => ({
          type,
          path: vars.paths[type] ?? type,
        }));
  const enriched = base.map((inst) => ({
    ...inst,
    upper: shellSafeUpper(inst.path),
    display: inst.path === inst.type ? CANONICAL_DISPLAY[inst.type] : inst.path,
  }));
  const byType = (type: Component) =>
    enriched
      .filter((i) => i.type === type)
      .sort((a, b) => a.path.localeCompare(b.path));
  return {
    ...vars,
    instances: enriched,
    fastapiInstances: byType("fastapi"),
    fastifyInstances: byType("fastify"),
    frontendInstances: byType("frontend"),
    mobileInstances: byType("mobile"),
    e2eInstances: byType("e2e"),
    infraInstances: byType("infra"),
  };
}

async function renderShared(
  filename: string,
  vars: GeneratorVars,
): Promise<string> {
  const tpl = await readFile(join(sharedTemplateDir(), filename), "utf-8");
  return render(tpl, vars);
}

export async function generateDockerCompose(
  vars: GeneratorVars,
): Promise<string> {
  return renderShared("docker-compose.yml.ejs", withInstances(vars));
}

export async function generateDockerComposeDev(
  vars: GeneratorVars,
): Promise<string> {
  return renderShared("docker-compose.dev.yml.ejs", withInstances(vars));
}

export async function generatePreCommit(vars: GeneratorVars): Promise<string> {
  return renderShared("pre-commit.ejs", withInstances(vars));
}

export async function generateSetupSh(vars: GeneratorVars): Promise<string> {
  return renderShared("setup.sh.ejs", withInstances(vars));
}

export async function generateCiYml(vars: GeneratorVars): Promise<string> {
  return renderShared("ci.yml.ejs", withInstances(vars));
}

export async function generateReadme(vars: GeneratorVars): Promise<string> {
  return renderShared("README.md.ejs", withInstances(vars));
}

export function generateVscodeSettings(vars: GeneratorVars): string {
  const settings: Record<string, unknown> = {};

  if (vars.components.includes("fastapi")) {
    settings["[python]"] = {
      "editor.defaultFormatter": "charliermarsh.ruff",
      "editor.codeActionsOnSave": { "source.fixAll.ruff": "explicit" },
    };
  }

  settings["[typescript]"] = {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
  };
  settings["[typescriptreact]"] = {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
  };
  settings["[javascript]"] = {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
  };
  settings["[json]"] = { "editor.defaultFormatter": "esbenp.prettier-vscode" };
  settings["[css]"] = { "editor.defaultFormatter": "esbenp.prettier-vscode" };
  settings["[yaml]"] = { "editor.defaultFormatter": "esbenp.prettier-vscode" };
  settings["editor.formatOnSave"] = true;
  settings["editor.codeActionsOnSave"] = { "source.fixAll.eslint": "explicit" };
  settings["eslint.useFlatConfig"] = true;

  const prettierComponent = (["frontend", "fastify", "e2e"] as const).find(
    (c) => vars.components.includes(c),
  );
  if (prettierComponent) {
    settings["prettier.configPath"] =
      `${vars.paths[prettierComponent]}/.prettierrc`;
  }

  if (vars.components.includes("fastapi")) {
    settings["ruff.lineLength"] = 120;
    settings["python.analysis.extraPaths"] = [`${vars.paths.fastapi}/src`];
    settings["python.analysis.importFormat"] = "absolute";
  }

  return JSON.stringify(settings, null, 2) + "\n";
}
