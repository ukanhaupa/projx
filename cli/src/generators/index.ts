import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { render, sharedTemplateDir, type Component } from "../utils.js";

interface GeneratorVars {
  projectName: string;
  components: Component[];
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

export async function generateMakefile(vars: GeneratorVars): Promise<string> {
  return renderShared("Makefile.ejs", vars);
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
