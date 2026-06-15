import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Component,
  type OrmProvider,
  EXCLUDE,
  readFileOrNull,
} from './utils.js';

export interface DetectedComponent {
  component: Component;
  directory: string;
  confidence: 'high' | 'medium';
  evidence: string;
  orm?: OrmProvider;
}

export async function detectComponents(
  cwd: string,
): Promise<DetectedComponent[]> {
  const results: DetectedComponent[] = [];
  const entries = await readdir(cwd, { withFileTypes: true });

  const dirs = entries
    .filter(
      (e) => e.isDirectory() && !e.name.startsWith('.') && !EXCLUDE.has(e.name),
    )
    .map((e) => e.name);

  for (const dir of dirs) {
    const full = join(cwd, dir);
    const detections = await scanDirectory(full, dir);
    results.push(...detections);
  }

  return results;
}

async function scanDirectory(
  dir: string,
  relPath: string,
): Promise<DetectedComponent[]> {
  const results: DetectedComponent[] = [];

  const pyproject = await readFileOrNull(join(dir, 'pyproject.toml'));
  if (pyproject && /fastapi/i.test(pyproject)) {
    results.push({
      component: 'fastapi',
      directory: relPath,
      confidence: 'high',
      evidence: 'pyproject.toml has fastapi dependency',
    });
  }

  const pkg = await readPkg(dir);
  if (pkg) {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps.fastify) {
      results.push({
        component: 'fastify',
        directory: relPath,
        confidence: 'high',
        evidence: 'package.json has fastify dependency',
      });
    }

    if (allDeps.express) {
      results.push({
        component: 'express',
        directory: relPath,
        confidence: 'high',
        evidence: 'package.json has express dependency',
      });
    }

    if (allDeps.next) {
      results.push({
        component: 'nextjs',
        directory: relPath,
        confidence: 'high',
        evidence: 'package.json has next dependency',
      });
    } else if (allDeps.react || allDeps['react-dom']) {
      results.push({
        component: 'vitejs',
        directory: relPath,
        confidence: 'high',
        evidence: 'package.json has react dependency',
      });
    }

    if (allDeps['@playwright/test'] || allDeps.playwright) {
      results.push({
        component: 'e2e',
        directory: relPath,
        confidence: 'high',
        evidence: 'package.json has playwright dependency',
      });
    }
  }

  const pubspec = await readFileOrNull(join(dir, 'pubspec.yaml'));
  if (pubspec && /flutter:/i.test(pubspec)) {
    results.push({
      component: 'mobile',
      directory: relPath,
      confidence: 'high',
      evidence: 'pubspec.yaml has flutter dependency',
    });
  }

  if (existsSync(join(dir, 'go.mod'))) {
    const goMod = await readFileOrNull(join(dir, 'go.mod'));
    if (!goMod || !/^module\s+adminpanel\b/m.test(goMod)) {
      const orm = detectGoOrm(dir);
      results.push({
        component: 'go',
        directory: relPath,
        confidence: 'high',
        evidence: orm ? `go.mod present (orm: ${orm})` : 'go.mod present',
        orm,
      });
    }
  }

  const cargo = await readFileOrNull(join(dir, 'Cargo.toml'));
  if (cargo && /(^|\n)\s*axum\s*=/.test(cargo)) {
    const orm: OrmProvider | undefined = /(^|\n)\s*sea-orm\s*=/.test(cargo)
      ? 'seaorm'
      : undefined;
    results.push({
      component: 'rust',
      directory: relPath,
      confidence: 'high',
      evidence: orm ? 'Cargo.toml has axum + sea-orm' : 'Cargo.toml has axum',
      orm,
    });
  }

  const composer = await readFileOrNull(join(dir, 'composer.json'));
  if (composer) {
    try {
      const parsed = JSON.parse(composer) as {
        require?: Record<string, string>;
        'require-dev'?: Record<string, string>;
      };
      const deps = {
        ...(parsed.require ?? {}),
        ...(parsed['require-dev'] ?? {}),
      };
      if (deps['laravel/framework']) {
        results.push({
          component: 'laravel',
          directory: relPath,
          confidence: 'high',
          evidence: 'composer.json has laravel/framework',
          orm: 'eloquent',
        });
      }
    } catch {
      // not valid json
    }
  }

  const hasTf =
    existsSync(join(dir, 'main.tf')) ||
    existsSync(join(dir, 'variables.tf')) ||
    existsSync(join(dir, 'stack/main.tf')) ||
    existsSync(join(dir, 'versions.tf'));
  if (hasTf) {
    results.push({
      component: 'infra',
      directory: relPath,
      confidence: 'high',
      evidence: 'Terraform .tf files found',
    });
  }

  const goMod = await readFileOrNull(join(dir, 'go.mod'));
  if (goMod && /^module\s+adminpanel\b/m.test(goMod)) {
    results.push({
      component: 'admin-panel',
      directory: relPath,
      confidence: 'high',
      evidence: 'Go module "adminpanel" found',
    });
  }

  return results;
}

function detectGoOrm(dir: string): OrmProvider | undefined {
  if (
    existsSync(join(dir, 'sqlc.yaml')) ||
    existsSync(join(dir, 'sqlc.yml')) ||
    existsSync(join(dir, 'sqlc.json'))
  ) {
    return 'sqlc';
  }
  if (existsSync(join(dir, 'ent')) && existsSync(join(dir, 'ent/schema'))) {
    return 'ent';
  }
  return undefined;
}

async function readPkg(dir: string): Promise<{
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | null> {
  const content = await readFileOrNull(join(dir, 'package.json'));
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}
