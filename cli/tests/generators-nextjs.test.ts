import { describe, it, expect } from 'vitest';
import {
  generateDockerCompose,
  generateCiYml,
} from '../src/generators/index.js';
import { pmCommands, type Component } from '../src/utils.js';

const pm = pmCommands('pnpm');

describe('nextjs generators', () => {
  it('enriches a canonical nextjs instance with display name and standalone service', async () => {
    const vars = {
      projectName: 'my-app',
      components: ['nextjs'] as Component[],
      paths: { nextjs: 'nextjs' } as Record<Component, string>,
      pm,
    };

    const compose = await generateDockerCompose(vars);
    expect(compose).toContain('  nextjs:');
    expect(compose).toContain('NEXT_PUBLIC_API_URL');
    expect(compose).toContain('"3000:3000"');
    expect(compose).not.toContain('certbot');

    const ci = await generateCiYml(vars);
    expect(ci).toContain(
      'name: Next.js (format + lint + typecheck + build + test + audit)',
    );
    expect(ci).toContain("nextjs:\n              - 'nextjs/**'");
  });

  it('honours a custom instance path (display falls back to the path, upper is shell-safe)', async () => {
    const vars = {
      projectName: 'my-app',
      components: ['nextjs'] as Component[],
      paths: { nextjs: 'web-app' } as Record<Component, string>,
      instances: [{ type: 'nextjs' as Component, path: 'web-app' }],
      pm,
    };

    const compose = await generateDockerCompose(vars);
    expect(compose).toContain('  web-app:');
    expect(compose).toContain('context: ./web-app');

    const ci = await generateCiYml(vars);
    expect(ci).toContain('web-app: ${{ steps.filter.outputs.web-app }}');
    expect(ci).toContain('name: web-app (format + lint + typecheck');
  });
});
