import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseFeatureFlag,
  validateFeatureTargets,
  applyFeature,
  applyFeatures,
  type FeatureTarget,
} from '../src/features.js';
import type { ComponentInstance } from '../src/utils.js';

describe('parseFeatureFlag', () => {
  it('returns empty array for empty input', () => {
    expect(parseFeatureFlag('')).toEqual([]);
    expect(parseFeatureFlag('   ')).toEqual([]);
  });

  it('parses a single target without instance', () => {
    expect(parseFeatureFlag('fastify')).toEqual([{ component: 'fastify' }]);
  });

  it('parses a single target with instance', () => {
    expect(parseFeatureFlag('fastify:api')).toEqual([
      { component: 'fastify', instance: 'api' },
    ]);
  });

  it('parses comma-separated targets', () => {
    expect(parseFeatureFlag('fastify:api,frontend,mobile:app')).toEqual([
      { component: 'fastify', instance: 'api' },
      { component: 'vitejs' },
      { component: 'mobile', instance: 'app' },
    ]);
  });

  it('trims whitespace around tokens', () => {
    expect(parseFeatureFlag(' fastify : api ,  frontend ')).toEqual([
      { component: 'fastify', instance: 'api' },
      { component: 'vitejs' },
    ]);
  });

  it('rejects unknown component', () => {
    expect(() => parseFeatureFlag('unknown')).toThrow(/unknown component/i);
  });

  it('rejects empty target piece', () => {
    expect(() => parseFeatureFlag('fastify,,frontend')).toThrow(
      /empty target/i,
    );
  });

  it('rejects extra colons in target', () => {
    expect(() => parseFeatureFlag('fastify:api:extra')).toThrow(/invalid/i);
  });
});

describe('validateFeatureTargets', () => {
  const instances: ComponentInstance[] = [
    { type: 'fastify', path: 'api' },
    { type: 'fastify', path: 'admin-api' },
    { type: 'vitejs', path: 'vitejs' },
  ];

  it('accepts targets that resolve cleanly', () => {
    const targets: FeatureTarget[] = [
      { component: 'fastify', instance: 'api' },
      { component: 'vitejs' },
    ];
    expect(validateFeatureTargets(targets, instances, ['fastify'])).toEqual([
      { component: 'fastify', instance: 'api', path: 'api' },
      { component: 'vitejs', instance: 'vitejs', path: 'vitejs' },
    ]);
  });

  it('defaults to first instance (alphabetical) when not specified', () => {
    const targets: FeatureTarget[] = [{ component: 'fastify' }];
    const resolved = validateFeatureTargets(targets, instances, []);
    expect(resolved[0].path).toBe('admin-api');
  });

  it('throws when no instance of the requested component exists', () => {
    const targets: FeatureTarget[] = [{ component: 'mobile' }];
    expect(() => validateFeatureTargets(targets, instances, [])).toThrow(
      /no mobile instance/i,
    );
  });

  it('throws when instance suffix does not match any instance', () => {
    const targets: FeatureTarget[] = [
      { component: 'fastify', instance: 'missing' },
    ];
    expect(() => validateFeatureTargets(targets, instances, [])).toThrow(
      /no fastify instance.*missing/i,
    );
  });

  it('rejects targets unsupported by feature', () => {
    const targets: FeatureTarget[] = [{ component: 'infra' }];
    const supports = ['fastify', 'fastapi', 'vitejs', 'mobile'];
    expect(() =>
      validateFeatureTargets(targets, instances, [], supports),
    ).toThrow(/does not support infra/i);
  });
});

describe('applyFeature', () => {
  let dest: string;
  let featureRoot: string;

  beforeEach(async () => {
    dest = await mkdtemp(join(tmpdir(), 'projx-feature-'));
    featureRoot = await mkdtemp(join(tmpdir(), 'projx-feature-src-'));
  });

  afterEach(async () => {
    await rm(dest, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
    await rm(featureRoot, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  });

  async function setupFeature(): Promise<void> {
    const featureDir = join(featureRoot, 'sample');
    await mkdir(join(featureDir, 'fastify/files/src'), { recursive: true });
    await mkdir(join(featureDir, 'fastify/patches'), { recursive: true });

    await writeFile(
      join(featureDir, 'feature.json'),
      JSON.stringify({
        name: 'sample',
        summary: 'Sample feature',
        supports: ['fastify'],
        env: { fastify: ['SAMPLE_KEY', 'SAMPLE_OTHER'] },
      }),
    );

    await writeFile(
      join(featureDir, 'fastify/files/src/sample.ts'),
      "export const NAME = '<%= projectName %>';\n",
    );

    await writeFile(
      join(featureDir, 'fastify/patches/01-package-json.patch.json'),
      JSON.stringify({
        type: 'package-json',
        merge: {
          dependencies: { 'sample-dep': '^1.0.0' },
          scripts: { sample: 'echo sample' },
        },
      }),
    );

    await writeFile(
      join(featureDir, 'fastify/patches/02-text.patch.json'),
      JSON.stringify({
        type: 'text',
        file: 'src/app.ts',
        anchor: '// projx-anchor: routes',
        insert: '  await app.register(samplePlugin);\n',
      }),
    );
  }

  async function setupTargetInstance(): Promise<void> {
    await mkdir(join(dest, 'api/src'), { recursive: true });
    await writeFile(
      join(dest, 'api/package.json'),
      JSON.stringify({ name: 'api', dependencies: { fastify: '^5.0.0' } }),
    );
    await writeFile(
      join(dest, 'api/src/app.ts'),
      "import fastify from 'fastify';\nconst app = fastify();\n// projx-anchor: routes\nexport default app;\n",
    );
    await writeFile(join(dest, 'api/.env.example'), 'EXISTING=value\n');
  }

  it('renders files into the target instance path', async () => {
    await setupFeature();
    await setupTargetInstance();

    await applyFeature({
      feature: 'sample',
      featureRoot,
      targets: [{ component: 'fastify', instance: 'api', path: 'api' }],
      dest,
      vars: { projectName: 'demo' },
    });

    const content = await readFile(join(dest, 'api/src/sample.ts'), 'utf-8');
    expect(content).toContain("export const NAME = 'demo'");
  });

  it('merges package-json patch deps and scripts', async () => {
    await setupFeature();
    await setupTargetInstance();

    await applyFeature({
      feature: 'sample',
      featureRoot,
      targets: [{ component: 'fastify', instance: 'api', path: 'api' }],
      dest,
      vars: { projectName: 'demo' },
    });

    const pkg = JSON.parse(
      await readFile(join(dest, 'api/package.json'), 'utf-8'),
    );
    expect(pkg.dependencies).toEqual({
      fastify: '^5.0.0',
      'sample-dep': '^1.0.0',
    });
    expect(pkg.scripts).toEqual({ sample: 'echo sample' });
  });

  it('inserts text after anchor comment', async () => {
    await setupFeature();
    await setupTargetInstance();

    await applyFeature({
      feature: 'sample',
      featureRoot,
      targets: [{ component: 'fastify', instance: 'api', path: 'api' }],
      dest,
      vars: { projectName: 'demo' },
    });

    const app = await readFile(join(dest, 'api/src/app.ts'), 'utf-8');
    expect(app).toMatch(
      /\/\/ projx-anchor: routes\n {2}await app\.register\(samplePlugin\);/,
    );
  });

  it('appends env keys to .env.example as commented placeholders', async () => {
    await setupFeature();
    await setupTargetInstance();

    await applyFeature({
      feature: 'sample',
      featureRoot,
      targets: [{ component: 'fastify', instance: 'api', path: 'api' }],
      dest,
      vars: { projectName: 'demo' },
    });

    const env = await readFile(join(dest, 'api/.env.example'), 'utf-8');
    expect(env).toContain('EXISTING=value');
    expect(env).toMatch(/# Added by feature: sample/);
    expect(env).toContain('# SAMPLE_KEY=');
    expect(env).toContain('# SAMPLE_OTHER=');
  });

  it('throws if anchor is missing in target file', async () => {
    await setupFeature();
    await setupTargetInstance();
    await writeFile(
      join(dest, 'api/src/app.ts'),
      "import fastify from 'fastify';\nconst app = fastify();\nexport default app;\n",
    );

    await expect(
      applyFeature({
        feature: 'sample',
        featureRoot,
        targets: [{ component: 'fastify', instance: 'api', path: 'api' }],
        dest,
        vars: { projectName: 'demo' },
      }),
    ).rejects.toThrow(/anchor.*not found/i);
  });

  it('is idempotent — re-running does not duplicate patches or env keys', async () => {
    await setupFeature();
    await setupTargetInstance();

    const opts = {
      feature: 'sample',
      featureRoot,
      targets: [
        { component: 'fastify' as const, instance: 'api', path: 'api' },
      ],
      dest,
      vars: { projectName: 'demo' },
    };

    await applyFeature(opts);
    await applyFeature(opts);

    const app = await readFile(join(dest, 'api/src/app.ts'), 'utf-8');
    const matches = app.match(/await app\.register\(samplePlugin\);/g);
    expect(matches?.length).toBe(1);

    const env = await readFile(join(dest, 'api/.env.example'), 'utf-8');
    expect(env.match(/# SAMPLE_KEY=/g)?.length).toBe(1);

    const pkg = JSON.parse(
      await readFile(join(dest, 'api/package.json'), 'utf-8'),
    );
    expect(pkg.dependencies['sample-dep']).toBe('^1.0.0');
  });

  it('throws if feature directory does not exist', async () => {
    await expect(
      applyFeature({
        feature: 'missing',
        featureRoot,
        targets: [{ component: 'fastify', instance: 'api', path: 'api' }],
        dest,
        vars: {},
      }),
    ).rejects.toThrow(/feature.*missing.*not found/i);
  });

  it('throws if feature does not support a requested component', async () => {
    await setupFeature();
    await mkdir(join(dest, 'vitejs'), { recursive: true });

    await expect(
      applyFeature({
        feature: 'sample',
        featureRoot,
        targets: [{ component: 'vitejs', instance: 'vitejs', path: 'vitejs' }],
        dest,
        vars: {},
      }),
    ).rejects.toThrow(/does not support vitejs/i);
  });

  it('applyFeatures orchestrator parses raw flag, validates, and applies', async () => {
    const fakeRepo = await mkdtemp(join(tmpdir(), 'projx-feature-repo-'));
    try {
      const featureDir = join(fakeRepo, 'features/auth');
      await mkdir(join(featureDir, 'fastify/files'), { recursive: true });
      await writeFile(
        join(featureDir, 'feature.json'),
        JSON.stringify({
          name: 'auth',
          summary: 'auth',
          supports: ['fastify'],
        }),
      );
      await writeFile(join(featureDir, 'fastify/files/auth.ts'), '// auth\n');

      await mkdir(join(dest, 'api'), { recursive: true });

      await applyFeatures({
        features: { auth: 'fastify:api' },
        repoDir: fakeRepo,
        components: ['fastify'],
        instances: [{ type: 'fastify', path: 'api' }],
        dest,
        vars: { projectName: 'demo' },
      });

      const content = await readFile(join(dest, 'api/auth.ts'), 'utf-8');
      expect(content).toContain('// auth');
    } finally {
      await rm(fakeRepo, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    }
  });

  it('applyFeatures throws when feature dir is missing in repo', async () => {
    const fakeRepo = await mkdtemp(join(tmpdir(), 'projx-feature-repo-'));
    try {
      await mkdir(join(dest, 'api'), { recursive: true });
      await expect(
        applyFeatures({
          features: { auth: 'fastify:api' },
          repoDir: fakeRepo,
          components: ['fastify'],
          instances: [{ type: 'fastify', path: 'api' }],
          dest,
          vars: {},
        }),
      ).rejects.toThrow(/Feature "auth" not found/);
    } finally {
      await rm(fakeRepo, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    }
  });

  it('applyFeatures skips empty feature values', async () => {
    const fakeRepo = await mkdtemp(join(tmpdir(), 'projx-feature-repo-'));
    try {
      await mkdir(join(dest, 'api'), { recursive: true });
      await applyFeatures({
        features: { auth: '' },
        repoDir: fakeRepo,
        components: ['fastify'],
        instances: [{ type: 'fastify', path: 'api' }],
        dest,
        vars: {},
      });
    } finally {
      await rm(fakeRepo, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    }
  });

  it('records applied feature in .projx-component marker', async () => {
    await setupFeature();
    await setupTargetInstance();
    await writeFile(
      join(dest, 'api/.projx-component'),
      JSON.stringify({ component: 'fastify', skip: [] }),
    );

    await applyFeature({
      feature: 'sample',
      featureRoot,
      targets: [{ component: 'fastify', instance: 'api', path: 'api' }],
      dest,
      vars: { projectName: 'demo' },
    });

    const marker = JSON.parse(
      await readFile(join(dest, 'api/.projx-component'), 'utf-8'),
    );
    expect(marker.features).toContain('sample');
  });

  it('applies common/ first, then ORM overlay; same-named patches win for ORM', async () => {
    const featureDir = join(featureRoot, 'sample');
    await mkdir(join(featureDir, 'fastify/common/files/src'), {
      recursive: true,
    });
    await mkdir(join(featureDir, 'fastify/common/patches'), {
      recursive: true,
    });
    await mkdir(join(featureDir, 'fastify/drizzle/files/src'), {
      recursive: true,
    });
    await mkdir(join(featureDir, 'fastify/drizzle/patches'), {
      recursive: true,
    });

    await writeFile(
      join(featureDir, 'feature.json'),
      JSON.stringify({
        name: 'sample',
        summary: 'Sample',
        supports: ['fastify'],
        requiresOrm: ['drizzle'],
      }),
    );

    await writeFile(
      join(featureDir, 'fastify/common/files/src/shared.ts'),
      "export const FROM = 'common';\n",
    );
    await writeFile(
      join(featureDir, 'fastify/common/files/src/overlap.ts'),
      "export const OVERLAP = 'common';\n",
    );
    await writeFile(
      join(featureDir, 'fastify/drizzle/files/src/overlap.ts'),
      "export const OVERLAP = 'drizzle';\n",
    );
    await writeFile(
      join(featureDir, 'fastify/drizzle/files/src/drizzle-only.ts'),
      "export const FROM = 'drizzle';\n",
    );

    await writeFile(
      join(featureDir, 'fastify/common/patches/01-plugin.patch.json'),
      JSON.stringify({
        type: 'text',
        file: 'src/app.ts',
        anchor: '// projx-anchor: routes',
        insert: '  await app.register(commonPlugin);\n',
      }),
    );
    await writeFile(
      join(featureDir, 'fastify/drizzle/patches/01-plugin.patch.json'),
      JSON.stringify({
        type: 'text',
        file: 'src/app.ts',
        anchor: '// projx-anchor: routes',
        insert: '  await app.register(drizzlePlugin);\n',
      }),
    );

    await setupTargetInstance();

    await applyFeature({
      feature: 'sample',
      featureRoot,
      targets: [{ component: 'fastify', instance: 'api', path: 'api' }],
      dest,
      vars: { projectName: 'demo', orm: 'drizzle' },
    });

    const shared = await readFile(join(dest, 'api/src/shared.ts'), 'utf-8');
    expect(shared).toContain("FROM = 'common'");

    const overlap = await readFile(join(dest, 'api/src/overlap.ts'), 'utf-8');
    expect(overlap).toContain("OVERLAP = 'drizzle'");

    const drizzleOnly = await readFile(
      join(dest, 'api/src/drizzle-only.ts'),
      'utf-8',
    );
    expect(drizzleOnly).toContain("FROM = 'drizzle'");

    const app = await readFile(join(dest, 'api/src/app.ts'), 'utf-8');
    expect(app).toContain('drizzlePlugin');
    expect(app).not.toContain('commonPlugin');
  });

  it('supports position: "before" on text patches', async () => {
    const featureDir = join(featureRoot, 'sample');
    await mkdir(join(featureDir, 'fastify/files'), { recursive: true });
    await mkdir(join(featureDir, 'fastify/patches'), { recursive: true });

    await writeFile(
      join(featureDir, 'feature.json'),
      JSON.stringify({
        name: 'sample',
        summary: 'Sample',
        supports: ['fastify'],
      }),
    );
    await writeFile(
      join(featureDir, 'fastify/patches/01-before.patch.json'),
      JSON.stringify({
        type: 'text',
        file: 'src/app.ts',
        anchor: '// projx-anchor: routes',
        insert: '  // before-anchor\n',
        position: 'before',
      }),
    );

    await setupTargetInstance();

    await applyFeature({
      feature: 'sample',
      featureRoot,
      targets: [{ component: 'fastify', instance: 'api', path: 'api' }],
      dest,
      vars: {},
    });

    const app = await readFile(join(dest, 'api/src/app.ts'), 'utf-8');
    const beforeIdx = app.indexOf('// before-anchor');
    const anchorIdx = app.indexOf('// projx-anchor: routes');
    expect(beforeIdx).toBeGreaterThan(-1);
    expect(beforeIdx).toBeLessThan(anchorIdx);
  });

  it('throws when package-json patch targets a missing package.json', async () => {
    const featureDir = join(featureRoot, 'sample');
    await mkdir(join(featureDir, 'fastify/patches'), { recursive: true });

    await writeFile(
      join(featureDir, 'feature.json'),
      JSON.stringify({
        name: 'sample',
        summary: 'Sample',
        supports: ['fastify'],
      }),
    );
    await writeFile(
      join(featureDir, 'fastify/patches/01-pkg.patch.json'),
      JSON.stringify({
        type: 'package-json',
        merge: { dependencies: { foo: '^1.0.0' } },
      }),
    );

    await mkdir(join(dest, 'api/src'), { recursive: true });
    await writeFile(
      join(dest, 'api/src/app.ts'),
      "import fastify from 'fastify';\n",
    );

    await expect(
      applyFeature({
        feature: 'sample',
        featureRoot,
        targets: [{ component: 'fastify', instance: 'api', path: 'api' }],
        dest,
        vars: {},
      }),
    ).rejects.toThrow(/package-json patch failed.*not found/i);
  });
});

describe('composer-json patch', () => {
  let dest: string;
  let featureRoot: string;

  beforeEach(async () => {
    dest = await mkdtemp(join(tmpdir(), 'projx-composer-'));
    featureRoot = await mkdtemp(join(tmpdir(), 'projx-composer-src-'));
  });

  afterEach(async () => {
    await rm(dest, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
    await rm(featureRoot, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  });

  async function setupComposerFeature(
    merge: Record<string, Record<string, string>>,
  ): Promise<void> {
    const featureDir = join(featureRoot, 'sample');
    await mkdir(join(featureDir, 'laravel/patches'), { recursive: true });
    await writeFile(
      join(featureDir, 'feature.json'),
      JSON.stringify({
        name: 'sample',
        summary: 'Sample feature',
        supports: ['laravel'],
      }),
    );
    await writeFile(
      join(featureDir, 'laravel/patches/01-composer.patch.json'),
      JSON.stringify({ type: 'composer-json', merge }),
    );
  }

  async function setupLaravelTarget(
    composer: Record<string, unknown>,
  ): Promise<void> {
    await mkdir(join(dest, 'laravel'), { recursive: true });
    await writeFile(
      join(dest, 'laravel/composer.json'),
      JSON.stringify(composer, null, 4) + '\n',
    );
  }

  function apply(): Promise<void> {
    return applyFeature({
      feature: 'sample',
      featureRoot,
      targets: [{ component: 'laravel', instance: 'laravel', path: 'laravel' }],
      dest,
      vars: { orm: 'eloquent' },
    });
  }

  it('deep-merges require and require-dev without injecting a comment', async () => {
    await setupComposerFeature({
      require: {
        'pragmarx/google2fa': '^8.0',
        'bacon/bacon-qr-code': '^2.0',
      },
      'require-dev': { 'phpstan/phpstan-strict-rules': '^2.0' },
    });
    await setupLaravelTarget({
      name: 'demo/app',
      require: { php: '^8.3', 'laravel/framework': '^12.0' },
      'require-dev': { 'pestphp/pest': '^3.7' },
    });

    await apply();

    const raw = await readFile(join(dest, 'laravel/composer.json'), 'utf-8');
    expect(raw).not.toContain('projx-feature');
    expect(raw).not.toContain('//');
    const composer = JSON.parse(raw) as {
      require: Record<string, string>;
      'require-dev': Record<string, string>;
    };
    expect(composer.require).toMatchObject({
      php: '^8.3',
      'laravel/framework': '^12.0',
      'pragmarx/google2fa': '^8.0',
      'bacon/bacon-qr-code': '^2.0',
    });
    expect(composer['require-dev']).toMatchObject({
      'pestphp/pest': '^3.7',
      'phpstan/phpstan-strict-rules': '^2.0',
    });
  });

  it('sorts the merged require keys alphabetically', async () => {
    await setupComposerFeature({
      require: { 'pragmarx/google2fa': '^8.0' },
    });
    await setupLaravelTarget({
      name: 'demo/app',
      require: { 'laravel/framework': '^12.0', php: '^8.3' },
    });

    await apply();

    const composer = JSON.parse(
      await readFile(join(dest, 'laravel/composer.json'), 'utf-8'),
    ) as { require: Record<string, string> };
    expect(Object.keys(composer.require)).toEqual([
      'laravel/framework',
      'php',
      'pragmarx/google2fa',
    ]);
  });

  it('is idempotent — re-running keeps valid JSON and no duplicates', async () => {
    await setupComposerFeature({
      require: { 'pragmarx/google2fa': '^8.0' },
    });
    await setupLaravelTarget({
      name: 'demo/app',
      require: { php: '^8.3' },
    });

    await apply();
    const first = await readFile(join(dest, 'laravel/composer.json'), 'utf-8');
    await apply();
    const second = await readFile(join(dest, 'laravel/composer.json'), 'utf-8');

    expect(second).toBe(first);
    const composer = JSON.parse(second) as {
      require: Record<string, string>;
    };
    expect(composer.require['pragmarx/google2fa']).toBe('^8.0');
  });

  it('creates a require block when the target has none', async () => {
    await setupComposerFeature({
      require: { 'pragmarx/google2fa': '^8.0' },
    });
    await setupLaravelTarget({ name: 'demo/app' });

    await apply();

    const composer = JSON.parse(
      await readFile(join(dest, 'laravel/composer.json'), 'utf-8'),
    ) as { require: Record<string, string> };
    expect(composer.require).toEqual({ 'pragmarx/google2fa': '^8.0' });
  });

  it('throws when composer.json is missing in the target', async () => {
    await setupComposerFeature({
      require: { 'pragmarx/google2fa': '^8.0' },
    });
    await mkdir(join(dest, 'laravel'), { recursive: true });

    await expect(apply()).rejects.toThrow(
      /composer-json patch failed.*not found/i,
    );
  });
});
