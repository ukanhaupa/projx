import { describe, expect, it, vi } from 'vitest';
import { handleMcpRequest, type McpRequest } from '../src/mcp.js';

describe('mcp request handler', () => {
  it('responds to initialize', async () => {
    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });
    const result = response.result as {
      protocolVersion?: string;
      capabilities?: unknown;
    };

    expect(response.id).toBe(1);
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.capabilities).toEqual({ tools: {} });
  });

  it('lists supported tools', async () => {
    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    const result = response.result as {
      tools?: Array<{ name: string }>;
    };

    const names = result.tools?.map((t) => t.name);
    expect(names).toContain('projx_scaffold');
    expect(names).toContain('projx_scaffold_fullstack');
    expect(names).toContain('projx_add_components');
    expect(names).toContain('projx_update');
    expect(names).toContain('projx_doctor');
  });

  it('calls scaffold_fullstack tool with mapped components', async () => {
    const scaffold = vi.fn(async () => undefined);

    const req: McpRequest = {
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: {
        name: 'projx_scaffold_fullstack',
        arguments: {
          project_name: 'saas-mvp',
          backend: 'fastapi',
          include_frontend: true,
          include_mobile: false,
          include_e2e: true,
          include_infra: true,
          package_manager: 'pnpm',
          install_deps: false,
          init_git: false,
          cwd: '/tmp',
        },
      },
    };

    const response = await handleMcpRequest(req, { scaffold });

    expect(scaffold).toHaveBeenCalledWith({
      name: 'saas-mvp',
      components: ['fastapi', 'frontend', 'e2e', 'infra'],
      git: false,
      install: false,
      packageManager: 'pnpm',
      cwd: '/tmp',
    });

    const result = response.result as { content?: Array<{ text?: string }> };
    expect(result.content?.[0]?.text).toContain(
      'Successfully scaffolded saas-mvp with fastapi',
    );
    expect(result.content?.[0]?.text).toContain('./saas-mvp');
  });

  it('returns a JSON-RPC error for invalid scaffold_fullstack args', async () => {
    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 31,
      method: 'tools/call',
      params: {
        name: 'projx_scaffold_fullstack',
        arguments: {
          project_name: 'oops',
        },
      },
    });

    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toContain('backend is required');
  });

  it('calls scaffold tool with validated arguments', async () => {
    const scaffold = vi.fn(async () => undefined);

    const req: McpRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'projx_scaffold',
        arguments: {
          name: 'my-app',
          components: ['fastify', 'frontend'],
          git: false,
          install: false,
        },
      },
    };

    const response = await handleMcpRequest(req, {
      scaffold,
    });

    expect(scaffold).toHaveBeenCalledWith({
      name: 'my-app',
      components: ['fastify', 'frontend'],
      git: false,
      install: false,
    });
    const result = response.result as {
      content?: Array<{ text?: string }>;
    };
    expect(result.content?.[0]?.text).toContain('Created project my-app');
  });

  it('returns a JSON-RPC error for unknown tool', async () => {
    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'unknown_tool',
        arguments: {},
      },
    });

    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toContain('Unknown tool');
  });

  it('returns a JSON-RPC error for invalid scaffold args', async () => {
    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'projx_scaffold',
        arguments: {
          components: ['fastify'],
        },
      },
    });

    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toContain('name is required');
  });
});
