import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  render,
  resolveInstanceOrm,
  sharedTemplateDir,
  type Component,
  type ComponentInstance,
  type ComponentPaths,
  type OrmProvider,
} from '../utils.js';

interface GeneratorVars {
  projectName: string;
  components: Component[];
  paths: ComponentPaths;
  instances?: ComponentInstance[];
  [key: string]: unknown;
}

function shellSafeUpper(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

const CANONICAL_DISPLAY: Record<Component, string> = {
  fastapi: 'FastAPI',
  fastify: 'Fastify',
  express: 'Express',
  go: 'Go',
  rust: 'Rust',
  laravel: 'Laravel',
  vitejs: 'React + Vite',
  nextjs: 'Next.js',
  mobile: 'Flutter',
  e2e: 'E2E',
  infra: 'Terraform',
  'admin-panel': 'Admin Panel',
};

function withInstances(vars: GeneratorVars): GeneratorVars {
  const base: ComponentInstance[] =
    vars.instances && vars.instances.length > 0
      ? vars.instances
      : vars.components.map((type) => ({
          type,
          path: vars.paths[type] ?? type,
        }));
  const globalOrm = vars.orm as OrmProvider | undefined;
  const enriched = base.map((inst) => ({
    ...inst,
    upper: shellSafeUpper(inst.path),
    display: inst.path === inst.type ? CANONICAL_DISPLAY[inst.type] : inst.path,
    orm: resolveInstanceOrm(inst.type, inst.orm, globalOrm),
  }));
  const byType = (type: Component) =>
    enriched
      .filter((i) => i.type === type)
      .sort((a, b) => a.path.localeCompare(b.path));
  return {
    ...vars,
    instances: enriched,
    fastapiInstances: byType('fastapi'),
    fastifyInstances: byType('fastify'),
    expressInstances: byType('express'),
    goInstances: byType('go'),
    rustInstances: byType('rust'),
    laravelInstances: byType('laravel'),
    vitejsInstances: byType('vitejs'),
    nextjsInstances: byType('nextjs'),
    mobileInstances: byType('mobile'),
    e2eInstances: byType('e2e'),
    infraInstances: byType('infra'),
    adminPanelInstances: byType('admin-panel'),
  };
}

async function renderShared(
  filename: string,
  vars: GeneratorVars,
): Promise<string> {
  const tpl = await readFile(join(sharedTemplateDir(), filename), 'utf-8');
  return render(tpl, vars);
}

export async function generateDockerCompose(
  vars: GeneratorVars,
): Promise<string> {
  return renderShared('docker-compose.yml.ejs', withInstances(vars));
}

export async function generatePreCommit(vars: GeneratorVars): Promise<string> {
  return renderShared('pre-commit.ejs', withInstances(vars));
}

export async function generateSetupSh(vars: GeneratorVars): Promise<string> {
  return renderShared('setup.sh.ejs', withInstances(vars));
}

export async function generateCiYml(vars: GeneratorVars): Promise<string> {
  return renderShared('ci.yml.ejs', withInstances(vars));
}

export async function generateReadme(vars: GeneratorVars): Promise<string> {
  return renderShared('README.md.ejs', withInstances(vars));
}

function infraTemplateVars(vars: GeneratorVars): GeneratorVars {
  const projectName = vars.projectName;
  const productionDomain =
    (vars.productionDomain as string | undefined) ??
    `${projectName}.example.com`;
  const awsRegion = (vars.awsRegion as string | undefined) ?? 'us-east-1';
  const githubOwner = (vars.githubOwner as string | undefined) ?? 'TODO';
  const ecrRepos = (vars.ecrRepos as string[] | undefined) ?? [
    `${projectName}/backend`,
    `${projectName}/frontend`,
  ];
  return {
    ...vars,
    productionDomain,
    awsRegion,
    githubOwner,
    ecrRepos,
    displayName: projectName.charAt(0).toUpperCase() + projectName.slice(1),
  };
}

export async function generateRollback(vars: GeneratorVars): Promise<string> {
  return renderShared('rollback.sh.ejs', infraTemplateVars(vars));
}

export async function generateCodeowners(vars: GeneratorVars): Promise<string> {
  return renderShared('codeowners.ejs', withInstances(infraTemplateVars(vars)));
}

export async function generateRunbook(vars: GeneratorVars): Promise<string> {
  return renderShared('runbook.md.ejs', infraTemplateVars(vars));
}

export function generateVscodeSettings(vars: GeneratorVars): string {
  const settings: Record<string, unknown> = {};

  if (vars.components.includes('fastapi')) {
    settings['[python]'] = {
      'editor.defaultFormatter': 'charliermarsh.ruff',
      'editor.codeActionsOnSave': { 'source.fixAll.ruff': 'explicit' },
    };
  }

  settings['[typescript]'] = {
    'editor.defaultFormatter': 'esbenp.prettier-vscode',
  };
  settings['[typescriptreact]'] = {
    'editor.defaultFormatter': 'esbenp.prettier-vscode',
  };
  settings['[javascript]'] = {
    'editor.defaultFormatter': 'esbenp.prettier-vscode',
  };
  settings['[json]'] = { 'editor.defaultFormatter': 'esbenp.prettier-vscode' };
  settings['[css]'] = { 'editor.defaultFormatter': 'esbenp.prettier-vscode' };
  settings['[yaml]'] = { 'editor.defaultFormatter': 'esbenp.prettier-vscode' };
  settings['editor.formatOnSave'] = true;
  settings['editor.codeActionsOnSave'] = { 'source.fixAll.eslint': 'explicit' };
  settings['eslint.useFlatConfig'] = true;

  const prettierComponent = (
    ['vitejs', 'nextjs', 'fastify', 'express', 'e2e'] as const
  ).find((c) => vars.components.includes(c));
  if (prettierComponent) {
    settings['prettier.configPath'] =
      `${vars.paths[prettierComponent]}/.prettierrc`;
  }

  if (vars.components.includes('fastapi')) {
    settings['ruff.lineLength'] = 120;
    settings['python.analysis.extraPaths'] = [`${vars.paths.fastapi}/src`];
    settings['python.analysis.importFormat'] = 'absolute';
  }

  return JSON.stringify(settings, null, 2) + '\n';
}
