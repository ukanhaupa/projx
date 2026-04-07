import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { render, sharedTemplateDir, type Component, type ComponentPaths } from "../utils.js";

interface GeneratorVars {
  projectName: string;
  components: Component[];
  paths: ComponentPaths;
  pathsUpper?: Partial<Record<Component, string>>;
  displayNames?: Partial<Record<Component, string>>;
  [key: string]: unknown;
}

async function renderShared(
  filename: string,
  vars: GeneratorVars,
): Promise<string> {
  const tpl = await readFile(
    join(sharedTemplateDir(), filename),
    "utf-8",
  );
  return render(tpl, vars);
}

export async function generateDockerCompose(
  vars: GeneratorVars,
): Promise<string> {
  return renderShared("docker-compose.yml.ejs", vars);
}

export async function generateDockerComposeDev(
  vars: GeneratorVars,
): Promise<string> {
  return renderShared("docker-compose.dev.yml.ejs", vars);
}

export async function generatePreCommit(vars: GeneratorVars): Promise<string> {
  return renderShared("pre-commit.ejs", vars);
}

export async function generateSetupSh(vars: GeneratorVars): Promise<string> {
  return renderShared("setup.sh.ejs", vars);
}

export async function generateCiYml(vars: GeneratorVars): Promise<string> {
  return renderShared("ci.yml.ejs", vars);
}

export async function generateReadme(vars: GeneratorVars): Promise<string> {
  return renderShared("README.md.ejs", vars);
}

export function generateVscodeSettings(vars: GeneratorVars): string {
  const settings: Record<string, unknown> = {};

  if (vars.components.includes("fastapi")) {
    settings["[python]"] = {
      "editor.defaultFormatter": "charliermarsh.ruff",
      "editor.codeActionsOnSave": { "source.fixAll.ruff": "explicit" },
    };
  }

  settings["[typescript]"] = { "editor.defaultFormatter": "esbenp.prettier-vscode" };
  settings["[typescriptreact]"] = { "editor.defaultFormatter": "esbenp.prettier-vscode" };
  settings["[javascript]"] = { "editor.defaultFormatter": "esbenp.prettier-vscode" };
  settings["[json]"] = { "editor.defaultFormatter": "esbenp.prettier-vscode" };
  settings["[css]"] = { "editor.defaultFormatter": "esbenp.prettier-vscode" };
  settings["[yaml]"] = { "editor.defaultFormatter": "esbenp.prettier-vscode" };
  settings["editor.formatOnSave"] = true;
  settings["editor.codeActionsOnSave"] = { "source.fixAll.eslint": "explicit" };
  settings["eslint.useFlatConfig"] = true;

  const prettierComponent = (["frontend", "fastify", "e2e"] as const).find((c) =>
    vars.components.includes(c),
  );
  if (prettierComponent) {
    settings["prettier.configPath"] = `${vars.paths[prettierComponent]}/.prettierrc`;
  }

  if (vars.components.includes("fastapi")) {
    settings["ruff.lineLength"] = 120;
    settings["python.analysis.extraPaths"] = [`${vars.paths.fastapi}/src`];
    settings["python.analysis.importFormat"] = "absolute";
  }

  return JSON.stringify(settings, null, 2) + "\n";
}
