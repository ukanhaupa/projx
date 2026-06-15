import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import {
  COMPONENT_MARKER,
  type Component,
  type ComponentPaths,
  discoverComponentsFromMarkers,
  readComponentMarker,
  readProjxConfig,
} from './utils.js';
import { BASELINE_REF, matchesSkip, saveBaselineRef } from './baseline.js';

interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
  autoFixable?: boolean;
}

async function checkConfig(cwd: string): Promise<{
  results: CheckResult[];
  rootConfig?: Record<string, unknown>;
}> {
  const results: CheckResult[] = [];
  const configPath = join(cwd, '.projx');

  if (!existsSync(configPath)) {
    results.push({
      name: '.projx exists',
      status: 'fail',
      message: 'No .projx file found.',
      fix: "Run 'npx create-projx init' to initialize.",
    });
    return { results };
  }

  const rootConfig = await readProjxConfig(cwd);
  if (Object.keys(rootConfig).length === 0) {
    results.push({
      name: '.projx valid JSON',
      status: 'fail',
      message: '.projx contains invalid JSON or is empty.',
    });
    return { results };
  }

  results.push({
    name: '.projx exists',
    status: 'pass',
    message: `v${rootConfig.version ?? 'unknown'}`,
  });

  if (!rootConfig.version) {
    results.push({
      name: '.projx fields',
      status: 'warn',
      message: 'Missing version field.',
    });
  }

  return { results, rootConfig };
}

async function checkComponents(
  cwd: string,
  components: Component[],
  componentPaths: ComponentPaths,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  if (components.length === 0) {
    results.push({
      name: 'components',
      status: 'fail',
      message: `No ${COMPONENT_MARKER} files found in any directory.`,
      fix: "Run 'npx create-projx init' to detect and mark components.",
    });
    return results;
  }

  results.push({
    name: 'components',
    status: 'pass',
    message: `${components.length} discovered from markers`,
  });

  for (const component of components) {
    const dir = componentPaths[component];
    const fullDir = join(cwd, dir);

    if (!existsSync(fullDir)) {
      results.push({
        name: `${component} directory`,
        status: 'fail',
        message: `Directory ${dir}/ not found.`,
      });
      continue;
    }

    const marker = await readComponentMarker(fullDir);
    if (!marker) {
      results.push({
        name: `${component} marker`,
        status: 'fail',
        message: `No ${COMPONENT_MARKER} in ${dir}/.`,
        fix: `Run 'npx create-projx update' to regenerate markers.`,
      });
      continue;
    }

    const label =
      dir !== component ? `${dir}/ (${component})` : `${component}/`;
    results.push({
      name: `${component} marker`,
      status: 'pass',
      message: label,
    });
  }

  return results;
}

function checkGit(cwd: string, fix: boolean): CheckResult[] {
  const results: CheckResult[] = [];

  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' });
    results.push({ name: 'git repo', status: 'pass', message: 'OK' });
  } catch {
    results.push({
      name: 'git repo',
      status: 'fail',
      message: 'Not a git repository.',
    });
    return results;
  }

  // Baseline ref
  try {
    const ref = execSync(`git rev-parse --verify ${BASELINE_REF}`, {
      cwd,
      stdio: 'pipe',
    })
      .toString()
      .trim();
    results.push({
      name: 'baseline ref',
      status: 'pass',
      message: ref.slice(0, 8),
    });
  } catch {
    if (fix) {
      saveBaselineRef(cwd);
      try {
        execSync(`git rev-parse --verify ${BASELINE_REF}`, {
          cwd,
          stdio: 'pipe',
        });
        results.push({
          name: 'baseline ref',
          status: 'pass',
          message: 'Created from git history.',
        });
      } catch {
        results.push({
          name: 'baseline ref',
          status: 'warn',
          message: 'Missing. Could not auto-create.',
          fix: "Run 'npx create-projx update' to establish baseline.",
        });
      }
    } else {
      results.push({
        name: 'baseline ref',
        status: 'warn',
        message: "Missing. Run 'projx doctor --fix' to create.",
        autoFixable: true,
      });
    }
  }

  // Stale worktrees
  try {
    const worktrees = execSync('git worktree list --porcelain', {
      cwd,
      stdio: 'pipe',
    }).toString();
    const stale = worktrees
      .split('\n')
      .filter((l) => l.includes('projx-wt-') || l.includes('projx/tmp-'));
    if (stale.length > 0) {
      if (fix) {
        execSync('git worktree prune', { cwd, stdio: 'pipe' });
        results.push({
          name: 'worktrees',
          status: 'pass',
          message: 'Pruned stale worktrees.',
        });
      } else {
        results.push({
          name: 'worktrees',
          status: 'warn',
          message: 'Stale projx worktrees found.',
          fix: "Run 'projx doctor --fix' to prune.",
          autoFixable: true,
        });
      }
    } else {
      results.push({ name: 'worktrees', status: 'pass', message: 'Clean' });
    }
  } catch {
    results.push({ name: 'worktrees', status: 'pass', message: 'OK' });
  }

  // Working tree status
  try {
    const status = execSync('git status --porcelain', { cwd, stdio: 'pipe' })
      .toString()
      .trim();
    if (status) {
      const count = status.split('\n').length;
      results.push({
        name: 'working tree',
        status: 'warn',
        message: `${count} uncommitted change(s).`,
      });
    } else {
      results.push({ name: 'working tree', status: 'pass', message: 'Clean' });
    }
  } catch {
    // non-critical
  }

  return results;
}

async function checkSkipPatterns(
  cwd: string,
  rootConfig: Record<string, unknown>,
  components: Component[],
  componentPaths: ComponentPaths,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const rootSkip: string[] = Array.isArray(rootConfig.skip)
    ? (rootConfig.skip as string[])
    : [];
  for (const pattern of rootSkip) {
    const matches = await patternMatchesAnything(cwd, pattern);
    if (!matches) {
      results.push({
        name: 'root skip',
        status: 'warn',
        message: `"${pattern}" matches no files — stale?`,
      });
    }
  }

  for (const component of components) {
    const dir = componentPaths[component];
    const marker = await readComponentMarker(join(cwd, dir));
    if (marker?.skip && marker.skip.length > 0) {
      for (const pattern of marker.skip) {
        const matches = await patternMatchesAnything(join(cwd, dir), pattern);
        if (!matches) {
          results.push({
            name: `${component} skip`,
            status: 'warn',
            message: `"${pattern}" matches no files — stale?`,
          });
        }
      }
    }
  }

  if (results.length === 0 && (rootSkip.length > 0 || components.length > 0)) {
    results.push({
      name: 'skip patterns',
      status: 'pass',
      message: 'All patterns match files.',
    });
  }

  return results;
}

const GO_MIN_MAJOR = 1;
const GO_MIN_MINOR = 25;

export function parseGoVersion(
  raw: string,
): { major: number; minor: number } | null {
  const m = /go(\d+)\.(\d+)(?:\.\d+)?/.exec(raw);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

export function isGoVersionSupported(v: {
  major: number;
  minor: number;
}): boolean {
  if (v.major > GO_MIN_MAJOR) return true;
  if (v.major < GO_MIN_MAJOR) return false;
  return v.minor >= GO_MIN_MINOR;
}

const RUST_MIN = { major: 1, minor: 83, patch: 0 };
const PHP_MIN = { major: 8, minor: 3, patch: 0 };
const COMPOSER_MIN_MAJOR = 2;

function compareSemver(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number },
): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function parseSemver(
  v: string,
): { major: number; minor: number; patch: number } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function parseRustVersion(output: string): string | null {
  const m = /rustc\s+(\d+\.\d+\.\d+)/.exec(output);
  return m ? m[1] : null;
}

export function isRustVersionSupported(version: string): boolean {
  const v = parseSemver(version);
  if (!v) return false;
  return compareSemver(v, RUST_MIN) >= 0;
}

export function parsePhpVersion(output: string): string | null {
  const m = /PHP\s+(\d+\.\d+\.\d+)/.exec(output);
  return m ? m[1] : null;
}

export function isPhpVersionSupported(version: string): boolean {
  const v = parseSemver(version);
  if (!v) return false;
  return compareSemver(v, PHP_MIN) >= 0;
}

export function parseComposerVersion(output: string): string | null {
  const m = /Composer(?:\s+version)?\s+(\d+\.\d+\.\d+)/.exec(output);
  return m ? m[1] : null;
}

function which(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkGoComponent(
  cwd: string,
  goDir: string,
  orm: string,
): CheckResult[] {
  const results: CheckResult[] = [];
  const fullDir = join(cwd, goDir);

  try {
    const raw = execSync('go version', { cwd: fullDir, stdio: 'pipe' })
      .toString()
      .trim();
    const parsed = parseGoVersion(raw);
    if (!parsed) {
      results.push({
        name: 'go toolchain',
        status: 'fail',
        message: `Could not parse 'go version' output: ${raw}`,
      });
    } else if (!isGoVersionSupported(parsed)) {
      results.push({
        name: 'go toolchain',
        status: 'fail',
        message: `Go ${parsed.major}.${parsed.minor} detected; need >= ${GO_MIN_MAJOR}.${GO_MIN_MINOR}.`,
        fix: 'Upgrade Go via https://go.dev/dl/ or your package manager.',
      });
    } else {
      results.push({
        name: 'go toolchain',
        status: 'pass',
        message: `${parsed.major}.${parsed.minor}`,
      });
    }
  } catch {
    results.push({
      name: 'go toolchain',
      status: 'fail',
      message: "'go' not on PATH.",
      fix: 'Install Go >= 1.25 from https://go.dev/dl/.',
    });
    return results;
  }

  const goMod = join(fullDir, 'go.mod');
  if (existsSync(goMod)) {
    results.push({
      name: 'go.mod',
      status: 'pass',
      message: `${goDir}/go.mod`,
    });
  } else {
    results.push({
      name: 'go.mod',
      status: 'fail',
      message: `Missing ${goDir}/go.mod.`,
      fix: `Run 'go mod init' in ${goDir}/.`,
    });
  }

  if (which('golangci-lint')) {
    try {
      const lintRaw = execSync('golangci-lint --version', { stdio: 'pipe' })
        .toString()
        .trim();
      const m = /version\s+v?(\d+)\./i.exec(lintRaw);
      const major = m ? Number(m[1]) : 0;
      if (major >= 2) {
        results.push({
          name: 'golangci-lint',
          status: 'pass',
          message: `v${major}.x`,
        });
      } else {
        results.push({
          name: 'golangci-lint',
          status: 'warn',
          message: `Detected v${major || '?'}.x — projx Go uses v2.`,
          fix: 'Install golangci-lint v2: https://golangci-lint.run/welcome/install/.',
        });
      }
    } catch {
      results.push({
        name: 'golangci-lint',
        status: 'warn',
        message: 'Present but version probe failed.',
      });
    }
  } else {
    results.push({
      name: 'golangci-lint',
      status: 'warn',
      message: 'Not on PATH; CI will still gate lint.',
      fix: 'Install for local checks: https://golangci-lint.run/welcome/install/.',
    });
  }

  if (which('govulncheck')) {
    results.push({ name: 'govulncheck', status: 'pass', message: 'OK' });
  } else {
    results.push({
      name: 'govulncheck',
      status: 'warn',
      message: 'Not on PATH; CI will still gate vuln scan.',
      fix: 'Install: go install golang.org/x/vuln/cmd/govulncheck@latest.',
    });
  }

  if (orm === 'sqlc') {
    if (which('sqlc')) {
      results.push({ name: 'sqlc CLI', status: 'pass', message: 'OK' });
    } else {
      results.push({
        name: 'sqlc CLI',
        status: 'warn',
        message: 'Not on PATH; required to regenerate sqlc-generated code.',
        fix: 'Install: brew install sqlc OR go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest.',
      });
    }
  } else if (orm === 'ent') {
    const entSchema = join(fullDir, 'ent/schema');
    if (!existsSync(entSchema)) {
      results.push({
        name: 'ent schema',
        status: 'warn',
        message: `Missing ${goDir}/ent/schema/.`,
        fix: `Run 'go run -mod=mod entgo.io/ent/cmd/ent new <Entity>' inside ${goDir}/.`,
      });
    } else {
      try {
        execSync('go generate ./...', { cwd: fullDir, stdio: 'pipe' });
        results.push({
          name: 'ent generate',
          status: 'pass',
          message: 'go generate ./... succeeded',
        });
      } catch {
        results.push({
          name: 'ent generate',
          status: 'warn',
          message: "'go generate ./...' failed; run manually to inspect.",
          fix: `cd ${goDir} && go generate ./...`,
        });
      }
    }
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    results.push({
      name: 'DATABASE_URL',
      status: 'warn',
      message: 'Unset — entity-registry runtime checks need Postgres.',
      fix: `Set DATABASE_URL in ${goDir}/.env to enable runtime checks.`,
    });
  } else if (which('psql')) {
    try {
      execSync(`psql "${dbUrl}" -c 'SELECT 1' >/dev/null 2>&1`, {
        stdio: 'pipe',
      });
      results.push({
        name: 'DATABASE_URL',
        status: 'pass',
        message: 'Postgres reachable',
      });
    } catch {
      results.push({
        name: 'DATABASE_URL',
        status: 'warn',
        message: 'Set but Postgres not reachable.',
      });
    }
  } else {
    results.push({
      name: 'DATABASE_URL',
      status: 'pass',
      message: 'Set (psql not on PATH; reachability skipped).',
    });
  }

  return results;
}

function probeDatabaseUrl(label: string, hintDir: string): CheckResult {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return {
      name: 'DATABASE_URL',
      status: 'warn',
      message: `Unset — ${label} runtime checks need a database.`,
      fix: `Set DATABASE_URL in ${hintDir}/.env to enable runtime checks.`,
    };
  }
  if (which('psql')) {
    try {
      execSync(`psql "${dbUrl}" -c 'SELECT 1' >/dev/null 2>&1`, {
        stdio: 'pipe',
      });
      return {
        name: 'DATABASE_URL',
        status: 'pass',
        message: 'Postgres reachable',
      };
    } catch {
      return {
        name: 'DATABASE_URL',
        status: 'warn',
        message: 'Set but Postgres not reachable.',
      };
    }
  }
  return {
    name: 'DATABASE_URL',
    status: 'pass',
    message: 'Set (psql not on PATH; reachability skipped).',
  };
}

function checkRustComponent(cwd: string, rustDir: string): CheckResult[] {
  const results: CheckResult[] = [];
  const fullDir = join(cwd, rustDir);

  try {
    const raw = execSync('cargo --version', { cwd: fullDir, stdio: 'pipe' })
      .toString()
      .trim();
    const m = /cargo\s+(\d+\.\d+\.\d+)/.exec(raw);
    if (m) {
      results.push({
        name: 'cargo',
        status: 'pass',
        message: m[1],
      });
    } else {
      results.push({
        name: 'cargo',
        status: 'warn',
        message: `Could not parse 'cargo --version' output: ${raw}`,
      });
    }
  } catch {
    results.push({
      name: 'cargo',
      status: 'fail',
      message: "'cargo' not on PATH.",
      fix: 'Install Rust via https://rustup.rs/.',
    });
    return results;
  }

  try {
    const raw = execSync('rustc --version', { cwd: fullDir, stdio: 'pipe' })
      .toString()
      .trim();
    const parsed = parseRustVersion(raw);
    if (!parsed) {
      results.push({
        name: 'rust toolchain',
        status: 'warn',
        message: `Could not parse 'rustc --version' output: ${raw}`,
      });
    } else if (!isRustVersionSupported(parsed)) {
      results.push({
        name: 'rust toolchain',
        status: 'fail',
        message: `Rust ${parsed} detected; need >= ${RUST_MIN.major}.${RUST_MIN.minor}.${RUST_MIN.patch}.`,
        fix: 'Upgrade via `rustup update stable`.',
      });
    } else {
      results.push({
        name: 'rust toolchain',
        status: 'pass',
        message: parsed,
      });
    }
  } catch {
    results.push({
      name: 'rust toolchain',
      status: 'warn',
      message: "'rustc' not on PATH.",
      fix: 'Install Rust via https://rustup.rs/.',
    });
  }

  const cargoToml = join(fullDir, 'Cargo.toml');
  if (existsSync(cargoToml)) {
    results.push({
      name: 'Cargo.toml',
      status: 'pass',
      message: `${rustDir}/Cargo.toml`,
    });
  } else {
    results.push({
      name: 'Cargo.toml',
      status: 'fail',
      message: `Missing ${rustDir}/Cargo.toml.`,
      fix: `Run 'cargo init' in ${rustDir}/.`,
    });
  }

  if (which('rustfmt')) {
    results.push({ name: 'rustfmt', status: 'pass', message: 'OK' });
  } else {
    results.push({
      name: 'rustfmt',
      status: 'warn',
      message: 'Not on PATH; CI will still gate formatting.',
      fix: 'Install: rustup component add rustfmt.',
    });
  }

  if (which('clippy-driver')) {
    try {
      const raw = execSync('clippy-driver --version', { stdio: 'pipe' })
        .toString()
        .trim();
      results.push({ name: 'clippy', status: 'pass', message: raw });
    } catch {
      results.push({
        name: 'clippy',
        status: 'warn',
        message: 'Present but version probe failed.',
      });
    }
  } else {
    results.push({
      name: 'clippy',
      status: 'warn',
      message: 'Not on PATH; CI will still gate lint.',
      fix: 'Install: rustup component add clippy.',
    });
  }

  results.push(probeDatabaseUrl('rust', rustDir));

  return results;
}

function checkLaravelComponent(cwd: string, laravelDir: string): CheckResult[] {
  const results: CheckResult[] = [];
  const fullDir = join(cwd, laravelDir);

  try {
    const raw = execSync('php --version', { cwd: fullDir, stdio: 'pipe' })
      .toString()
      .trim();
    const parsed = parsePhpVersion(raw);
    if (!parsed) {
      results.push({
        name: 'php',
        status: 'fail',
        message: `Could not parse 'php --version' output: ${raw}`,
      });
    } else if (!isPhpVersionSupported(parsed)) {
      results.push({
        name: 'php',
        status: 'fail',
        message: `PHP ${parsed} detected; need >= ${PHP_MIN.major}.${PHP_MIN.minor}.${PHP_MIN.patch}.`,
        fix: 'Upgrade PHP to >= 8.3 via your package manager.',
      });
    } else {
      results.push({ name: 'php', status: 'pass', message: parsed });
    }
  } catch {
    results.push({
      name: 'php',
      status: 'fail',
      message: "'php' not on PATH.",
      fix: 'Install PHP >= 8.3 via your package manager.',
    });
    return results;
  }

  try {
    const raw = execSync('composer --version', { cwd: fullDir, stdio: 'pipe' })
      .toString()
      .trim();
    const parsed = parseComposerVersion(raw);
    if (!parsed) {
      results.push({
        name: 'composer',
        status: 'fail',
        message: `Could not parse 'composer --version' output: ${raw}`,
      });
    } else {
      const sem = parseSemver(parsed);
      if (!sem || sem.major < COMPOSER_MIN_MAJOR) {
        results.push({
          name: 'composer',
          status: 'fail',
          message: `Composer ${parsed} detected; need >= ${COMPOSER_MIN_MAJOR}.0.0.`,
          fix: 'Upgrade Composer: composer self-update --2.',
        });
      } else {
        results.push({ name: 'composer', status: 'pass', message: parsed });
      }
    }
  } catch {
    results.push({
      name: 'composer',
      status: 'fail',
      message: "'composer' not on PATH.",
      fix: 'Install Composer >= 2.0 from https://getcomposer.org/.',
    });
    return results;
  }

  const composerJson = join(fullDir, 'composer.json');
  if (existsSync(composerJson)) {
    results.push({
      name: 'composer.json',
      status: 'pass',
      message: `${laravelDir}/composer.json`,
    });
  } else {
    results.push({
      name: 'composer.json',
      status: 'fail',
      message: `Missing ${laravelDir}/composer.json.`,
      fix: `Run 'composer init' in ${laravelDir}/.`,
    });
  }

  const envFile = join(fullDir, '.env');
  if (existsSync(envFile)) {
    results.push({
      name: '.env',
      status: 'pass',
      message: `${laravelDir}/.env`,
    });
  } else {
    results.push({
      name: '.env',
      status: 'warn',
      message: `Missing ${laravelDir}/.env.`,
      fix: `cp ${laravelDir}/.env.example ${laravelDir}/.env && php artisan key:generate.`,
    });
  }

  results.push(probeDatabaseUrl('laravel', laravelDir));

  return results;
}

async function patternMatchesAnything(
  dir: string,
  pattern: string,
): Promise<boolean> {
  if (pattern === '**') return true;
  if (!existsSync(dir)) return false;

  const walk = async (current: string, base: string): Promise<boolean> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      const rel = full.slice(base.length + 1);

      if (entry.isDirectory()) {
        if (await walk(full, base)) return true;
      } else if (matchesSkip(rel, [pattern])) {
        return true;
      }
    }
    return false;
  };

  return walk(dir, dir);
}

export async function doctor(cwd: string, fix = false): Promise<void> {
  p.intro('projx doctor');

  const allResults: CheckResult[] = [];

  const { results: configResults, rootConfig } = await checkConfig(cwd);
  allResults.push(...configResults);

  if (!rootConfig) {
    printReport(allResults);
    process.exit(1);
  }

  const { components, paths: componentPaths } =
    await discoverComponentsFromMarkers(cwd);
  allResults.push(...(await checkComponents(cwd, components, componentPaths)));

  allResults.push(...checkGit(cwd, fix));

  if (components.includes('go')) {
    const orm = typeof rootConfig.orm === 'string' ? rootConfig.orm : 'gorm';
    allResults.push(...checkGoComponent(cwd, componentPaths.go, orm));
  }

  if (components.includes('rust')) {
    allResults.push(...checkRustComponent(cwd, componentPaths.rust));
  }

  if (components.includes('laravel')) {
    allResults.push(...checkLaravelComponent(cwd, componentPaths.laravel));
  }

  allResults.push(
    ...(await checkSkipPatterns(cwd, rootConfig, components, componentPaths)),
  );

  printReport(allResults);

  const passed = allResults.filter((r) => r.status === 'pass').length;
  const warns = allResults.filter((r) => r.status === 'warn').length;
  const fails = allResults.filter((r) => r.status === 'fail').length;

  const fixable = allResults.filter((r) => r.autoFixable);
  if (fixable.length > 0 && !fix) {
    p.log.info(`${fixable.length} issue(s) auto-fixable with --fix`);
  }

  p.outro(`${passed} passed, ${warns} warning(s), ${fails} failed`);

  if (fails > 0) process.exit(1);
}

function printReport(results: CheckResult[]): void {
  for (const r of results) {
    const icon =
      r.status === 'pass'
        ? '\u2713'
        : r.status === 'warn'
          ? '\u26A0'
          : '\u2717';
    const msg = `${icon} ${r.name} \u2014 ${r.message}`;

    if (r.status === 'pass') p.log.success(msg);
    else if (r.status === 'warn') p.log.warn(msg);
    else p.log.error(msg);

    if (r.fix) p.log.info(`  ${r.fix}`);
  }
}
