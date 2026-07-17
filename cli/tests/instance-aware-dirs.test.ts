import { describe, it, expect } from 'vitest';
import { generateCodeowners } from '../src/generators/index.js';
import {
  resolvePrimarySourceDirs,
  type Component,
  type ComponentInstance,
  type ComponentPaths,
} from '../src/utils.js';

describe('resolvePrimarySourceDirs', () => {
  it('picks the first present backend and frontend by priority (fastapi > fastify, vitejs > nextjs)', () => {
    const paths = {
      fastify: 'fastify',
      fastapi: 'fastapi',
      vitejs: 'vitejs',
      nextjs: 'nextjs',
    } as ComponentPaths;
    expect(resolvePrimarySourceDirs(paths)).toEqual({
      backendSourceDir: 'fastapi',
      frontendSourceDir: 'vitejs',
    });
  });

  it('honours renamed instance directories', () => {
    const paths = {
      express: 'api',
      nextjs: 'web',
    } as ComponentPaths;
    expect(resolvePrimarySourceDirs(paths)).toEqual({
      backendSourceDir: 'api',
      frontendSourceDir: 'web',
    });
  });

  it('falls back to conventional names when a tier is absent', () => {
    expect(resolvePrimarySourceDirs({} as ComponentPaths)).toEqual({
      backendSourceDir: 'backend',
      frontendSourceDir: 'frontend',
    });
  });
});

describe('generateCodeowners is instance-aware', () => {
  const base = {
    projectName: 'my-app',
    githubOwner: 'octocat',
  };

  it('emits resolved directories for renamed instances', async () => {
    const components: Component[] = ['fastify', 'admin-panel', 'infra'];
    const instances: ComponentInstance[] = [
      { type: 'fastify', path: 'backend' },
      { type: 'admin-panel', path: 'adminui' },
      { type: 'infra', path: 'deploy' },
    ];
    const out = await generateCodeowners({
      ...base,
      components,
      paths: {
        fastify: 'backend',
        'admin-panel': 'adminui',
        infra: 'deploy',
      } as ComponentPaths,
      instances,
    });
    expect(out).toContain('deploy/ @octocat');
    expect(out).toContain('backend/prisma/migrations/ @octocat');
    expect(out).toContain('adminui/internal/db/migrations/ @octocat');
    expect(out).not.toContain('infra/ @octocat');
    expect(out).not.toContain('admin-panel/internal/db/migrations/');
  });

  it('omits a tier entirely when the component is absent', async () => {
    const components: Component[] = ['fastify'];
    const out = await generateCodeowners({
      ...base,
      components,
      paths: { fastify: 'fastify' } as ComponentPaths,
      instances: [{ type: 'fastify', path: 'fastify' }],
    });
    expect(out).toContain('fastify/prisma/migrations/ @octocat');
    expect(out).not.toContain('/internal/db/migrations/');
  });
});
