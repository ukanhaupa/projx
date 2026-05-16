import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import {
  COMPONENTS,
  render,
  type Component,
  type ComponentInstance,
  type Feature,
} from './utils.js';

export interface FeatureTarget {
  component: Component;
  instance?: string;
}

export interface ResolvedFeatureTarget extends FeatureTarget {
  instance: string;
  path: string;
}

interface FeatureManifest {
  name: string;
  summary?: string;
  supports: Component[];
  env?: Partial<Record<Component, string[]>>;
  requires?: Partial<Record<Component, string[]>>;
  deps?: Partial<Record<Component, Record<string, string>>>;
}

interface PackageJsonPatch {
  type: 'package-json';
  merge: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
}

interface TextPatch {
  type: 'text';
  file: string;
  anchor: string;
  insert: string;
  position?: 'after' | 'before';
}

type Patch = PackageJsonPatch | TextPatch;

export interface ApplyFeatureOptions {
  feature: string;
  featureRoot: string;
  targets: ResolvedFeatureTarget[];
  dest: string;
  vars: Record<string, unknown>;
}

export function parseFeatureFlag(input: string): FeatureTarget[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const pieces = trimmed.split(',');
  const out: FeatureTarget[] = [];
  for (const raw of pieces) {
    const piece = raw.trim();
    if (!piece) {
      throw new Error(
        `Invalid feature flag: empty target in "${input}". Use "component[:instance],..." form.`,
      );
    }
    const parts = piece.split(':').map((p) => p.trim());
    if (parts.length > 2 || parts.some((p) => !p)) {
      throw new Error(
        `Invalid feature flag target "${piece}". Expected "component" or "component:instance".`,
      );
    }
    const [component, instance] = parts;
    if (!(COMPONENTS as readonly string[]).includes(component)) {
      throw new Error(
        `Unknown component "${component}". Valid: ${COMPONENTS.join(', ')}.`,
      );
    }
    out.push(
      instance
        ? { component: component as Component, instance }
        : { component: component as Component },
    );
  }
  return out;
}

export function validateFeatureTargets(
  targets: FeatureTarget[],
  instances: ComponentInstance[],
  _components: Component[],
  supports?: string[],
): ResolvedFeatureTarget[] {
  const resolved: ResolvedFeatureTarget[] = [];
  for (const t of targets) {
    if (supports && !supports.includes(t.component)) {
      throw new Error(
        `Feature does not support ${t.component}. Supported: ${supports.join(', ')}.`,
      );
    }
    const candidates = instances
      .filter((i) => i.type === t.component)
      .sort((a, b) => a.path.localeCompare(b.path));
    if (candidates.length === 0) {
      throw new Error(
        `No ${t.component} instance found. Add it to --components first.`,
      );
    }
    if (t.instance) {
      const match = candidates.find((c) => c.path === t.instance);
      if (!match) {
        const known = candidates.map((c) => c.path).join(', ');
        throw new Error(
          `No ${t.component} instance named "${t.instance}". Known: ${known}.`,
        );
      }
      resolved.push({
        component: t.component,
        instance: t.instance,
        path: match.path,
      });
    } else {
      resolved.push({
        component: t.component,
        instance: candidates[0].path,
        path: candidates[0].path,
      });
    }
  }
  return resolved;
}

export interface ApplyFeaturesOptions {
  features: Partial<Record<Feature, string>>;
  repoDir: string;
  components: Component[];
  instances: ComponentInstance[];
  dest: string;
  vars: Record<string, unknown>;
}

export async function applyFeatures(opts: ApplyFeaturesOptions): Promise<void> {
  const featureRoot = join(opts.repoDir, 'features');
  for (const [name, raw] of Object.entries(opts.features) as [
    Feature,
    string,
  ][]) {
    if (!raw) continue;
    const targets = parseFeatureFlag(raw);
    const featureDir = join(featureRoot, name);
    if (!existsSync(featureDir)) {
      throw new Error(
        `Feature "${name}" not found at ${featureDir}. Pin or update the repo to a version that ships this feature.`,
      );
    }
    const manifest = JSON.parse(
      await readFile(join(featureDir, 'feature.json'), 'utf-8'),
    ) as { supports: Component[]; requiresOrm?: string[] };
    if (manifest.requiresOrm && manifest.requiresOrm.length > 0) {
      const orm = (opts.vars.orm as string | undefined) ?? 'prisma';
      if (!manifest.requiresOrm.includes(orm)) {
        throw new Error(
          `Feature "${name}" requires --orm ${manifest.requiresOrm.join(' or ')} (got "${orm}").`,
        );
      }
    }
    const resolved = validateFeatureTargets(
      targets,
      opts.instances,
      opts.components,
      manifest.supports,
    );
    await applyFeature({
      feature: name,
      featureRoot,
      targets: resolved,
      dest: opts.dest,
      vars: opts.vars,
    });
  }
}

export async function applyFeature(opts: ApplyFeatureOptions): Promise<void> {
  const featureDir = join(opts.featureRoot, opts.feature);
  if (!existsSync(featureDir)) {
    throw new Error(
      `Feature "${opts.feature}" not found at ${featureDir}. Check feature name and repo version.`,
    );
  }

  const manifest = await readManifest(featureDir, opts.feature);

  for (const target of opts.targets) {
    if (!manifest.supports.includes(target.component)) {
      throw new Error(
        `Feature "${opts.feature}" does not support ${target.component}. Supported: ${manifest.supports.join(', ')}.`,
      );
    }
    await applyTarget({
      featureDir,
      featureName: opts.feature,
      manifest,
      target,
      dest: opts.dest,
      vars: { ...opts.vars, inst: target },
    });
  }
}

async function readManifest(
  featureDir: string,
  feature: string,
): Promise<FeatureManifest> {
  const path = join(featureDir, 'feature.json');
  if (!existsSync(path)) {
    throw new Error(`Feature "${feature}" missing feature.json at ${path}.`);
  }
  const raw = await readFile(path, 'utf-8');
  const manifest = JSON.parse(raw) as FeatureManifest;
  if (!manifest.name || !Array.isArray(manifest.supports)) {
    throw new Error(`Feature "${feature}" manifest is malformed.`);
  }
  return manifest;
}

interface ApplyTargetArgs {
  featureDir: string;
  featureName: string;
  manifest: FeatureManifest;
  target: ResolvedFeatureTarget;
  dest: string;
  vars: Record<string, unknown>;
}

async function applyTarget(args: ApplyTargetArgs): Promise<void> {
  const stackDir = join(args.featureDir, args.target.component);
  if (!existsSync(stackDir)) return;

  const targetPath = join(args.dest, args.target.path);
  if (!existsSync(targetPath)) {
    throw new Error(
      `Target instance path ${args.target.path} not found in ${args.dest}.`,
    );
  }

  const filesDir = join(stackDir, 'files');
  if (existsSync(filesDir)) {
    await renderFilesInto(filesDir, targetPath, args.vars);
  }

  const patchesDir = join(stackDir, 'patches');
  if (existsSync(patchesDir)) {
    await applyPatches(patchesDir, targetPath, args.featureName);
  }

  const envKeys = args.manifest.env?.[args.target.component] ?? [];
  if (envKeys.length > 0) {
    await appendEnvExample(targetPath, args.featureName, envKeys);
  }

  await recordFeatureInMarker(targetPath, args.featureName);
}

async function renderFilesInto(
  filesDir: string,
  targetPath: string,
  vars: Record<string, unknown>,
): Promise<void> {
  const entries = await collectFiles(filesDir);
  for (const rel of entries) {
    const src = join(filesDir, rel);
    const isEjs = rel.endsWith('.ejs');
    const outRel = isEjs ? rel.slice(0, -4) : rel;
    const dst = join(targetPath, outRel);
    await mkdir(dirname(dst), { recursive: true });
    if (isEjs || /\.(ts|tsx|js|jsx|py|dart|md|json|yml|yaml|html)$/.test(rel)) {
      const raw = await readFile(src, 'utf-8');
      await writeFile(dst, render(raw, vars));
    } else {
      await cp(src, dst);
    }
  }
}

async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(relative(root, full));
    }
  }
  await walk(root);
  return out.sort();
}

async function applyPatches(
  patchesDir: string,
  targetPath: string,
  featureName: string,
): Promise<void> {
  const files = (await readdir(patchesDir))
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const file of files) {
    const raw = await readFile(join(patchesDir, file), 'utf-8');
    const patch = JSON.parse(raw) as Patch;
    if (patch.type === 'package-json') {
      await applyPackageJsonPatch(targetPath, patch);
    } else if (patch.type === 'text') {
      await applyTextPatch(targetPath, patch, featureName);
    } else {
      throw new Error(
        `Unknown patch type in ${file}: ${(patch as { type: string }).type}.`,
      );
    }
  }
}

async function applyPackageJsonPatch(
  targetPath: string,
  patch: PackageJsonPatch,
): Promise<void> {
  const pkgPath = join(targetPath, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`package-json patch failed: ${pkgPath} not found.`);
  }
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as Record<
    string,
    unknown
  >;
  const merge = patch.merge;
  for (const key of ['dependencies', 'devDependencies', 'scripts'] as const) {
    const incoming = merge[key];
    if (!incoming) continue;
    pkg[key] = { ...((pkg[key] as Record<string, string>) ?? {}), ...incoming };
  }
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

async function applyTextPatch(
  targetPath: string,
  patch: TextPatch,
  featureName: string,
): Promise<void> {
  const filePath = join(targetPath, patch.file);
  if (!existsSync(filePath)) {
    throw new Error(
      `text patch failed: ${patch.file} not found in ${targetPath}.`,
    );
  }
  const content = await readFile(filePath, 'utf-8');
  const sentinel = sentinelFor(featureName, patch.anchor, patch.insert);
  if (content.includes(sentinel)) return;
  const idx = content.indexOf(patch.anchor);
  if (idx === -1) {
    throw new Error(
      `text patch anchor "${patch.anchor}" not found in ${patch.file}.`,
    );
  }
  const insertWithSentinel = patch.insert + sentinel;
  let next: string;
  if (patch.position === 'before') {
    next = content.slice(0, idx) + insertWithSentinel + content.slice(idx);
  } else {
    const end = idx + patch.anchor.length;
    const after = content.slice(end);
    const newline = after.startsWith('\n') ? '\n' : '\n';
    next =
      content.slice(0, end) +
      newline +
      insertWithSentinel +
      (after.startsWith('\n') ? after.slice(1) : after);
  }
  await writeFile(filePath, next);
}

function sentinelFor(feature: string, anchor: string, insert: string): string {
  const hash = simpleHash(anchor + '|' + insert);
  const isHash = anchor.includes('#');
  const open = isHash ? '# ' : '// ';
  return `${open}projx-feature: ${feature} ${hash}\n`;
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

async function appendEnvExample(
  targetPath: string,
  featureName: string,
  keys: string[],
): Promise<void> {
  const envPath = join(targetPath, '.env.example');
  let content = existsSync(envPath) ? await readFile(envPath, 'utf-8') : '';
  const header = `# Added by feature: ${featureName}`;
  if (content.includes(header)) return;
  if (content && !content.endsWith('\n')) content += '\n';
  content += `\n${header}\n`;
  for (const key of keys) content += `# ${key}=\n`;
  await writeFile(envPath, content);
}

async function recordFeatureInMarker(
  targetPath: string,
  featureName: string,
): Promise<void> {
  const markerPath = join(targetPath, '.projx-component');
  if (!existsSync(markerPath)) return;
  const raw = await readFile(markerPath, 'utf-8');
  const marker = JSON.parse(raw) as {
    component: string;
    skip: string[];
    features?: string[];
  };
  marker.features = marker.features ?? [];
  if (!marker.features.includes(featureName)) {
    marker.features.push(featureName);
    await writeFile(markerPath, JSON.stringify(marker, null, 2) + '\n');
  }
}
