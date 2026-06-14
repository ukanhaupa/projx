import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, matchFeatureFlag } from '../src/index.js';

const ENTRYPOINT = resolve(__dirname, '../src/index.ts');

const mocks = vi.hoisted(() => ({
  init: vi.fn(async (..._a: unknown[]) => {}),
  update: vi.fn(async (..._a: unknown[]) => {}),
  add: vi.fn(async (..._a: unknown[]) => {}),
  pin: vi.fn(async (..._a: unknown[]) => {}),
  unpin: vi.fn(async (..._a: unknown[]) => {}),
  listPins: vi.fn(async (..._a: unknown[]) => {}),
  diff: vi.fn(async (..._a: unknown[]) => {}),
  doctor: vi.fn(async (..._a: unknown[]) => {}),
  gen: vi.fn(async (..._a: unknown[]) => {}),
  scaffold: vi.fn(async (..._a: unknown[]) => {}),
  runPrompts: vi.fn(async (..._a: unknown[]) => ({
    name: 'prompted',
    components: ['fastify'],
    git: true,
    install: true,
    packageManager: 'pnpm',
    orm: 'prisma',
  })),
}));

const {
  init,
  update,
  add,
  pin,
  unpin,
  listPins,
  diff,
  doctor,
  gen,
  scaffold,
  runPrompts,
} = mocks;

vi.mock('../src/init.js', () => ({ init: mocks.init }));
vi.mock('../src/update.js', () => ({ update: mocks.update }));
vi.mock('../src/add.js', () => ({ add: mocks.add }));
vi.mock('../src/pin.js', () => ({
  pin: mocks.pin,
  unpin: mocks.unpin,
  listPins: mocks.listPins,
}));
vi.mock('../src/diff.js', () => ({ diff: mocks.diff }));
vi.mock('../src/doctor.js', () => ({ doctor: mocks.doctor }));
vi.mock('../src/gen.js', () => ({ gen: mocks.gen }));
vi.mock('../src/scaffold.js', () => ({ scaffold: mocks.scaffold }));
vi.mock('../src/prompts.js', () => ({
  runPrompts: mocks.runPrompts,
  LABELS: {},
}));

async function runMain(args: string[]): Promise<void> {
  const origArgv = process.argv;
  process.argv = ['node', ENTRYPOINT, ...args];
  vi.resetModules();
  try {
    await import(pathToFileURL(ENTRYPOINT).href);
    await new Promise((r) => setImmediate(r));
  } finally {
    process.argv = origArgv;
  }
}

describe('parseArgs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses each subcommand', () => {
    expect(parseArgs(['update']).command).toBe('update');
    expect(parseArgs(['add', 'fastify']).command).toBe('add');
    expect(parseArgs(['init']).command).toBe('init');
    expect(parseArgs(['pin', 'x']).command).toBe('pin');
    expect(parseArgs(['unpin', 'x']).command).toBe('unpin');
    expect(parseArgs(['diff']).command).toBe('diff');
    expect(parseArgs(['doctor']).command).toBe('doctor');
    expect(parseArgs(['gen', 'entity', 'foo']).command).toBe('gen');
  });

  it('defaults to create and captures the project name', () => {
    const parsed = parseArgs(['my-app']);
    expect(parsed.command).toBe('create');
    expect(parsed.name).toBe('my-app');
  });

  it('parses a valid --components list', () => {
    expect(parseArgs(['--components', 'fastify,frontend,e2e']).options).toEqual(
      {
        components: ['fastify', 'vitejs', 'e2e'],
      },
    );
  });

  it('throws on an unknown --components entry with a suggestion', () => {
    expect(() => parseArgs(['--components', 'fastify,admiin-panel'])).toThrow(
      /admiin-panel \(did you mean admin-panel\?\)/,
    );
    expect(() => parseArgs(['--components', 'bogusxyz'])).toThrow(
      /Invalid --components/,
    );
  });

  it('ignores --components with no value', () => {
    expect(parseArgs(['--components']).options.components).toBeUndefined();
  });

  it('accepts a valid --orm and throws on an invalid one', () => {
    expect(parseArgs(['--orm', 'drizzle']).options.orm).toBe('drizzle');
    expect(() => parseArgs(['--orm', 'bogus'])).toThrow();
    expect(() => parseArgs(['--orm'])).toThrow();
  });

  it('resolves --local to an absolute path', () => {
    expect(parseArgs(['--local', '/some/path']).localRepo).toBe(
      resolve('/some/path'),
    );
  });

  it('parses --no-git and --no-install', () => {
    expect(parseArgs(['--no-git']).options.git).toBe(false);
    expect(parseArgs(['--no-install']).options.install).toBe(false);
  });

  it('defaults components for -y and --yes', () => {
    expect(parseArgs(['-y']).options.components).toEqual([
      'fastify',
      'vitejs',
      'e2e',
    ]);
    expect(parseArgs(['--yes']).options.components).toEqual([
      'fastify',
      'vitejs',
      'e2e',
    ]);
  });

  it('keeps explicit components ahead of -y defaults', () => {
    expect(
      parseArgs(['--components', 'fastapi', '-y']).options.components,
    ).toEqual(['fastapi']);
  });

  it('parses boolean flags', () => {
    expect(parseArgs(['--list']).flags.list).toBe(true);
    expect(parseArgs(['-l']).flags.list).toBe(true);
    expect(parseArgs(['--fix']).flags.fix).toBe(true);
    expect(parseArgs(['--ai']).flags.ai).toBe(true);
    expect(parseArgs(['--backend']).flags.backend).toBe(true);
  });

  it('forwards --fields and --name into extraArgs', () => {
    expect(parseArgs(['--fields', 'a:string']).extraArgs).toContain(
      '--fields=a:string',
    );
    expect(parseArgs(['--name', 'foo']).extraArgs).toContain('--name=foo');
  });

  it('ignores --fields and --name with no value', () => {
    expect(parseArgs(['--fields']).extraArgs).toEqual([]);
    expect(parseArgs(['--name']).extraArgs).toEqual([]);
  });

  it('parses feature flags in =value and space forms', () => {
    expect(parseArgs(['--auth=fastify']).options.features).toEqual({
      auth: 'fastify',
    });
    expect(parseArgs(['--auth', 'fastify']).options.features).toEqual({
      auth: 'fastify',
    });
  });

  it('throws when a feature flag has no value', () => {
    expect(() => parseArgs(['--auth'])).toThrow();
  });

  it('routes positional args to extraArgs for add/pin/unpin/gen', () => {
    expect(parseArgs(['add', 'fastify', 'vitejs']).extraArgs).toEqual([
      'fastify',
      'vitejs',
    ]);
    expect(parseArgs(['pin', 'a', 'b']).extraArgs).toEqual(['a', 'b']);
    expect(parseArgs(['unpin', 'a']).extraArgs).toEqual(['a']);
    expect(parseArgs(['gen', 'entity', 'foo']).extraArgs).toEqual([
      'entity',
      'foo',
    ]);
  });

  it('captures only the first positional as name for create', () => {
    const parsed = parseArgs(['my-app', 'extra']);
    expect(parsed.name).toBe('my-app');
  });

  it('does not let a subcommand keyword override a captured name', () => {
    const parsed = parseArgs(['my-app', 'update']);
    expect(parsed.command).toBe('create');
    expect(parsed.name).toBe('my-app');
  });

  it('prints help and exits 0 for --help and -h', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('EXIT');
    });

    expect(() => parseArgs(['--help'])).toThrow('EXIT');
    expect(() => parseArgs(['-h'])).toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalled();
  });
});

describe('matchFeatureFlag', () => {
  it('parses the --feature=value form without consuming the next arg', () => {
    expect(matchFeatureFlag('--auth=fastify', ['--auth=fastify'], 0)).toEqual({
      feature: 'auth',
      value: 'fastify',
      consumedNext: false,
    });
  });

  it('parses the --feature value form and consumes the next arg', () => {
    expect(matchFeatureFlag('--auth', ['--auth', 'fastify'], 0)).toEqual({
      feature: 'auth',
      value: 'fastify',
      consumedNext: true,
    });
  });

  it('throws when the next arg is missing or another flag', () => {
    expect(() => matchFeatureFlag('--auth', ['--auth'], 0)).toThrow();
    expect(() =>
      matchFeatureFlag('--auth', ['--auth', '--no-git'], 0),
    ).toThrow();
  });

  it('returns null for an unrelated arg', () => {
    expect(matchFeatureFlag('--components', ['--components'], 0)).toBeNull();
  });
});

describe('main dispatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('dispatches init, update, diff and doctor', async () => {
    await runMain(['init']);
    expect(init).toHaveBeenCalled();
    await runMain(['update']);
    expect(update).toHaveBeenCalled();
    await runMain(['diff']);
    expect(diff).toHaveBeenCalled();
    await runMain(['doctor', '--fix']);
    expect(doctor).toHaveBeenCalledWith(expect.any(String), true);
  });

  it('adds components and honours --no-install', async () => {
    await runMain(['add', 'fastify', '--no-install']);
    expect(add).toHaveBeenCalledWith(
      expect.any(String),
      ['fastify'],
      undefined,
      true,
      undefined,
      undefined,
    );
  });

  it('normalizes the legacy frontend alias to vitejs in add', async () => {
    await runMain(['add', 'frontend', '--no-install']);
    expect(add).toHaveBeenCalledWith(
      expect.any(String),
      ['vitejs'],
      undefined,
      true,
      undefined,
      undefined,
    );
  });

  it('exits 2 with a suggestion when add gets an unknown component', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as never);
    await runMain(['add', 'admiin-panel']);
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('did you mean admin-panel?'),
    );
  });

  it('exits 2 when add is given no components at all', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as never);
    await runMain(['add']);
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(errSpy).toHaveBeenCalled();
  });

  it('exits 2 when --name is used with multiple add components', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as never);
    await runMain(['add', 'fastify', 'vitejs', '--name', 'x']);
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it('lists pins with --list and pins with patterns', async () => {
    await runMain(['pin', '--list']);
    expect(listPins).toHaveBeenCalled();
    await runMain(['pin', 'a/b.ts']);
    expect(pin).toHaveBeenCalledWith(expect.any(String), ['a/b.ts']);
  });

  it('unpins patterns and exits 1 when none given', async () => {
    await runMain(['unpin', 'a/b.ts']);
    expect(unpin).toHaveBeenCalledWith(expect.any(String), ['a/b.ts']);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as never);
    await runMain(['unpin']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('generates an entity and forwards fields and backend flags', async () => {
    await runMain(['gen', 'entity', 'invoice', '--fields', 'a:string', '--ai']);
    expect(gen).toHaveBeenCalledWith(
      expect.any(String),
      'invoice',
      'a:string',
      'fastapi',
      undefined,
    );

    gen.mockClear();
    await runMain(['gen', 'entity', 'invoice', '--backend']);
    expect(gen).toHaveBeenCalledWith(
      expect.any(String),
      'invoice',
      undefined,
      'fastify',
      undefined,
    );
  });

  it('exits 1 for a bad gen subcommand', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as never);
    await runMain(['gen', 'bogus']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('scaffolds when components and a name are given', async () => {
    await runMain(['my-app', '--components', 'fastify', '--no-git']);
    expect(scaffold).toHaveBeenCalled();
    const opts = scaffold.mock.calls[0][0] as unknown as {
      git: boolean;
      name: string;
    };
    expect(opts.name).toBe('my-app');
    expect(opts.git).toBe(false);
  });

  it('normalizes the legacy frontend alias to vitejs before scaffolding', async () => {
    await runMain(['my-app', '--components', 'frontend', '--no-git']);
    expect(scaffold).toHaveBeenCalled();
    const opts = scaffold.mock.calls[0][0] as unknown as {
      components: string[];
    };
    expect(opts.components).toEqual(['vitejs']);
  });

  it('exits 1 when components are given without a name', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as never);
    await runMain(['--components', 'fastify']);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(scaffold).not.toHaveBeenCalled();
  });

  it('falls back to prompts when no components flag is given', async () => {
    await runMain(['prompted']);
    expect(runPrompts).toHaveBeenCalled();
    expect(scaffold).toHaveBeenCalled();
  });
});
