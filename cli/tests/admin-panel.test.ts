import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from '../src/scaffold.js';

const REPO_DIR = join(import.meta.dirname, '../..');

describe('admin-panel component', () => {
  let dest: string;

  afterEach(async () => {
    if (dest)
      await rm(dest, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
  });

  it('scaffolds admin-panel standalone with its template files and marker', async () => {
    dest = join(tmpdir(), `projx-admin-panel-${Date.now()}`);
    await scaffold(
      {
        name: 'admin-app',
        components: ['admin-panel'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, '.projx'))).toBe(true);
    expect(existsSync(join(dest, 'admin-panel'))).toBe(true);
    expect(existsSync(join(dest, 'admin-panel/Dockerfile'))).toBe(true);
    expect(existsSync(join(dest, 'admin-panel/.env.example'))).toBe(true);

    const marker = JSON.parse(
      await readFile(join(dest, 'admin-panel/.projx-component'), 'utf-8'),
    );
    expect(marker.component).toBe('admin-panel');
  });

  it('emits an admin-panel service in docker-compose, internal-only', async () => {
    dest = join(tmpdir(), `projx-admin-panel-compose-${Date.now()}`);
    await scaffold(
      {
        name: 'admin-app',
        components: ['fastify', 'admin-panel'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const compose = await readFile(join(dest, 'docker-compose.yml'), 'utf-8');
    expect(compose).toContain('admin-panel:');
    expect(compose).toContain('./admin-panel/.env');
    expect(compose).toContain('"8055"');
    expect(compose).toContain('["CMD", "/admin", "healthcheck"]');
    expect(compose).not.toMatch(/admin-panel:[\s\S]*?\n {4}ports:/);
    expect(compose).not.toContain('/directus/uploads');
    expect(compose).not.toContain('/directus/extensions');
  });

  it('writes docker-compose for admin-panel even without a backend or frontend', async () => {
    dest = join(tmpdir(), `projx-admin-panel-only-compose-${Date.now()}`);
    await scaffold(
      {
        name: 'admin-app',
        components: ['admin-panel'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, 'docker-compose.yml'))).toBe(true);
    const compose = await readFile(join(dest, 'docker-compose.yml'), 'utf-8');
    expect(compose).toContain('admin-panel:');
  });

  it('routes /admin/ to the admin-panel upstream in the frontend nginx config', async () => {
    dest = join(tmpdir(), `projx-admin-panel-nginx-${Date.now()}`);
    await scaffold(
      {
        name: 'admin-app',
        components: ['vitejs', 'admin-panel'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const nginx = await readFile(join(dest, 'vitejs/nginx.conf'), 'utf-8');
    expect(nginx).toContain('location ^~ /admin/');
    expect(nginx).toContain('set $admin_panel_upstream admin-panel;');
    expect(nginx).toContain('proxy_pass http://$admin_panel_upstream:8055;');
    expect(nginx).toContain('proxy_set_header X-Forwarded-Prefix /admin;');
    expect(nginx).toContain('location = /admin {');
    expect(nginx).toContain('return 308 /admin/;');
  });

  it('emits an admin-panel setup block and README entry', async () => {
    dest = join(tmpdir(), `projx-admin-panel-templates-${Date.now()}`);
    await scaffold(
      {
        name: 'admin-app',
        components: ['admin-panel'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const setup = await readFile(join(dest, 'scripts/setup.sh'), 'utf-8');
    expect(setup).toContain('admin-panel/.env created from .env.example.');

    const readme = await readFile(join(dest, 'README.md'), 'utf-8');
    expect(readme).toContain('Go + HTMX admin panel');
    expect(readme).toContain('admin-panel/');
  });

  it('emits an admin-panel CI change-detection filter and build job', async () => {
    dest = join(tmpdir(), `projx-admin-panel-ci-${Date.now()}`);
    await scaffold(
      {
        name: 'admin-app',
        components: ['admin-panel'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const ci = await readFile(join(dest, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toContain('admin-panel:');
    expect(ci).toContain("'admin-panel/**'");
  });
});
