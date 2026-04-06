import { spawn } from 'node:child_process';
import {
  COMPONENTS,
  PACKAGE_MANAGERS,
  type Component,
  type PackageManager,
} from './utils.js';

type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | ReadonlyArray<Json>
  | { [key: string]: Json };

export interface McpRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, Json>;
}

interface McpError {
  code: number;
  message: string;
}

export interface McpResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: Json;
  error?: McpError;
}

interface ScaffoldArgs {
  name: string;
  components?: Component[];
  git?: boolean;
  install?: boolean;
  packageManager?: PackageManager;
  cwd?: string;
}

interface ScaffoldFullstackArgs {
  projectName: string;
  backend: 'fastapi' | 'fastify';
  includeFrontend: boolean;
  includeMobile: boolean;
  includeE2E: boolean;
  includeInfra: boolean;
  packageManager?: PackageManager;
  installDeps: boolean;
  initGit: boolean;
  cwd?: string;
}

interface AddArgs {
  components: Component[];
  cwd?: string;
  install?: boolean;
}

interface UpdateArgs {
  cwd?: string;
}

interface DoctorArgs {
  cwd?: string;
  fix?: boolean;
}

interface ToolActions {
  scaffold: (args: ScaffoldArgs) => Promise<void>;
  add: (args: AddArgs) => Promise<void>;
  update: (args: UpdateArgs) => Promise<void>;
  doctor: (args: DoctorArgs) => Promise<void>;
}

const MCP_PROTOCOL_VERSION = '2024-11-05';

const TOOL_DEFS = [
  {
    name: 'projx_scaffold',
    description: 'Create a new projx project',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        components: {
          type: 'array',
          items: { type: 'string', enum: [...COMPONENTS] },
        },
        git: { type: 'boolean' },
        install: { type: 'boolean' },
        cwd: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'projx_scaffold_fullstack',
    description:
      'Scaffold a production-ready fullstack app with backend, frontend, e2e, and optional mobile/infra',
    inputSchema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', minLength: 1 },
        backend: { type: 'string', enum: ['fastapi', 'fastify'] },
        include_frontend: { type: 'boolean', default: true },
        include_mobile: { type: 'boolean', default: false },
        include_e2e: { type: 'boolean', default: true },
        include_infra: { type: 'boolean', default: false },
        package_manager: { type: 'string', enum: [...PACKAGE_MANAGERS] },
        install_deps: { type: 'boolean', default: true },
        init_git: { type: 'boolean', default: true },
        cwd: { type: 'string' },
      },
      required: ['project_name', 'backend'],
      additionalProperties: false,
    },
  },
  {
    name: 'projx_add_components',
    description: 'Add components to an existing projx project',
    inputSchema: {
      type: 'object',
      properties: {
        components: {
          type: 'array',
          items: { type: 'string', enum: [...COMPONENTS] },
        },
        install: { type: 'boolean' },
        cwd: { type: 'string' },
      },
      required: ['components'],
      additionalProperties: false,
    },
  },
  {
    name: 'projx_update',
    description: 'Update an existing projx project to latest scaffolding',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'projx_doctor',
    description: 'Run projx health checks',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        fix: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
] as const;

function isComponent(value: unknown): value is Component {
  return typeof value === 'string' && COMPONENTS.includes(value as Component);
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function parseScaffoldArgs(raw: unknown): ScaffoldArgs {
  const args = ensureObject(raw);
  const name = args.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('name is required');
  }

  const parsed: ScaffoldArgs = { name: name.trim() };

  if (args.components !== undefined) {
    if (!Array.isArray(args.components))
      throw new Error('components must be an array');
    if (!args.components.every(isComponent)) {
      throw new Error(`components must be one of: ${COMPONENTS.join(', ')}`);
    }
    parsed.components = args.components as Component[];
  }
  if (args.git !== undefined) {
    if (typeof args.git !== 'boolean') throw new Error('git must be a boolean');
    parsed.git = args.git;
  }
  if (args.install !== undefined) {
    if (typeof args.install !== 'boolean')
      throw new Error('install must be a boolean');
    parsed.install = args.install;
  }
  if (args.cwd !== undefined) {
    if (typeof args.cwd !== 'string' || args.cwd.length === 0)
      throw new Error('cwd must be a string');
    parsed.cwd = args.cwd;
  }
  if (args.packageManager !== undefined) {
    if (
      typeof args.packageManager !== 'string' ||
      !PACKAGE_MANAGERS.includes(args.packageManager as PackageManager)
    ) {
      throw new Error(
        `packageManager must be one of: ${PACKAGE_MANAGERS.join(', ')}`,
      );
    }
    parsed.packageManager = args.packageManager as PackageManager;
  }

  return parsed;
}

function parseScaffoldFullstackArgs(raw: unknown): ScaffoldFullstackArgs {
  const args = ensureObject(raw);

  const projectName = args.project_name;
  if (typeof projectName !== 'string' || projectName.trim().length === 0) {
    throw new Error('project_name is required');
  }

  const backend = args.backend;
  if (backend !== 'fastapi' && backend !== 'fastify') {
    throw new Error('backend is required and must be fastapi or fastify');
  }

  const parsed: ScaffoldFullstackArgs = {
    projectName: projectName.trim(),
    backend,
    includeFrontend: args.include_frontend !== false,
    includeMobile: args.include_mobile === true,
    includeE2E: args.include_e2e !== false,
    includeInfra: args.include_infra === true,
    installDeps: args.install_deps !== false,
    initGit: args.init_git !== false,
  };

  if (args.package_manager !== undefined) {
    if (
      typeof args.package_manager !== 'string' ||
      !PACKAGE_MANAGERS.includes(args.package_manager as PackageManager)
    ) {
      throw new Error(
        `package_manager must be one of: ${PACKAGE_MANAGERS.join(', ')}`,
      );
    }
    parsed.packageManager = args.package_manager as PackageManager;
  }

  if (args.cwd !== undefined) {
    if (typeof args.cwd !== 'string' || args.cwd.length === 0)
      throw new Error('cwd must be a string');
    parsed.cwd = args.cwd;
  }

  return parsed;
}

function parseAddArgs(raw: unknown): AddArgs {
  const args = ensureObject(raw);
  if (!Array.isArray(args.components) || args.components.length === 0) {
    throw new Error('components is required');
  }
  if (!args.components.every(isComponent)) {
    throw new Error(`components must be one of: ${COMPONENTS.join(', ')}`);
  }

  const parsed: AddArgs = { components: args.components as Component[] };
  if (args.install !== undefined) {
    if (typeof args.install !== 'boolean')
      throw new Error('install must be a boolean');
    parsed.install = args.install;
  }
  if (args.cwd !== undefined) {
    if (typeof args.cwd !== 'string' || args.cwd.length === 0)
      throw new Error('cwd must be a string');
    parsed.cwd = args.cwd;
  }
  return parsed;
}

function parseUpdateArgs(raw: unknown): UpdateArgs {
  if (raw === undefined) return {};
  const args = ensureObject(raw);
  if (
    args.cwd !== undefined &&
    (typeof args.cwd !== 'string' || args.cwd.length === 0)
  ) {
    throw new Error('cwd must be a string');
  }
  return { cwd: args.cwd as string | undefined };
}

function parseDoctorArgs(raw: unknown): DoctorArgs {
  if (raw === undefined) return {};
  const args = ensureObject(raw);
  const parsed: DoctorArgs = {};
  if (args.cwd !== undefined) {
    if (typeof args.cwd !== 'string' || args.cwd.length === 0)
      throw new Error('cwd must be a string');
    parsed.cwd = args.cwd;
  }
  if (args.fix !== undefined) {
    if (typeof args.fix !== 'boolean') throw new Error('fix must be a boolean');
    parsed.fix = args.fix;
  }
  return parsed;
}

function jsonRpcError(
  id: string | number | undefined,
  code: number,
  message: string,
): McpResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
}

function textResult(
  id: string | number | undefined,
  text: string,
): McpResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text }],
    },
  };
}

async function runCli(args: string[], cwd?: string): Promise<void> {
  const entry = process.argv[1];
  if (!entry) {
    throw new Error('Unable to resolve CLI entrypoint');
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(
          new Error(stderr.trim() || `Command failed with exit code ${code}`),
        );
      }
    });
  });
}

function defaultActions(): ToolActions {
  return {
    scaffold: async ({
      name,
      components,
      git,
      install,
      packageManager,
      cwd,
    }) => {
      const cmd: string[] = [name];
      if (components && components.length > 0) {
        cmd.push('--components', components.join(','));
      }
      if (packageManager) {
        cmd.push('--package-manager', packageManager);
      }
      if (git === false) cmd.push('--no-git');
      if (install === false) cmd.push('--no-install');
      await runCli(cmd, cwd);
    },
    add: async ({ components, cwd, install }) => {
      const cmd: string[] = ['add', ...components];
      if (install === false) cmd.push('--no-install');
      await runCli(cmd, cwd);
    },
    update: async ({ cwd }) => {
      await runCli(['update'], cwd);
    },
    doctor: async ({ cwd, fix }) => {
      const cmd = ['doctor'];
      if (fix) cmd.push('--fix');
      await runCli(cmd, cwd);
    },
  };
}

export async function handleMcpRequest(
  request: McpRequest,
  actions?: Partial<ToolActions>,
): Promise<McpResponse> {
  if (request.jsonrpc !== '2.0') {
    return jsonRpcError(request.id, -32600, 'Invalid Request');
  }

  const effectiveActions: ToolActions = {
    ...defaultActions(),
    ...actions,
  };

  try {
    if (request.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'projx', version: '1.0.0' },
        },
      };
    }

    if (request.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: { tools: TOOL_DEFS },
      };
    }

    if (request.method === 'tools/call') {
      const params = ensureObject(request.params);
      const toolName = params.name;
      const toolArgs = params.arguments;

      if (typeof toolName !== 'string') {
        return jsonRpcError(request.id, -32602, 'name must be a string');
      }

      if (toolName === 'projx_scaffold') {
        const parsed = parseScaffoldArgs(toolArgs);
        await effectiveActions.scaffold(parsed);
        return textResult(request.id, `Created project ${parsed.name}`);
      }

      if (toolName === 'projx_scaffold_fullstack') {
        const parsed = parseScaffoldFullstackArgs(toolArgs);
        const components: Component[] = [parsed.backend];

        if (parsed.includeFrontend) components.push('frontend');
        if (parsed.includeMobile) components.push('mobile');
        if (parsed.includeE2E) components.push('e2e');
        if (parsed.includeInfra) components.push('infra');

        await effectiveActions.scaffold({
          name: parsed.projectName,
          components,
          git: parsed.initGit,
          install: parsed.installDeps,
          packageManager: parsed.packageManager,
          cwd: parsed.cwd,
        });

        return textResult(
          request.id,
          `Successfully scaffolded ${parsed.projectName} with ${parsed.backend}. Files are located at ./${parsed.projectName}`,
        );
      }

      if (toolName === 'projx_add_components') {
        const parsed = parseAddArgs(toolArgs);
        await effectiveActions.add(parsed);
        return textResult(
          request.id,
          `Added components: ${parsed.components.join(', ')}`,
        );
      }

      if (toolName === 'projx_update') {
        const parsed = parseUpdateArgs(toolArgs);
        await effectiveActions.update(parsed);
        return textResult(request.id, 'Updated projx scaffolding');
      }

      if (toolName === 'projx_doctor') {
        const parsed = parseDoctorArgs(toolArgs);
        await effectiveActions.doctor(parsed);
        return textResult(request.id, 'Doctor check completed');
      }

      return jsonRpcError(request.id, -32602, `Unknown tool: ${toolName}`);
    }

    if (request.method === 'ping') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: { ok: true },
      };
    }

    return jsonRpcError(
      request.id,
      -32601,
      `Method not found: ${request.method}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonRpcError(request.id, -32602, message);
  }
}

function writeMessage(msg: McpResponse): void {
  const payload = JSON.stringify(msg);
  const length = Buffer.byteLength(payload, 'utf8');
  process.stdout.write(`Content-Length: ${length}\r\n\r\n${payload}`);
}

export function startMcpServer(): void {
  let buffer = Buffer.alloc(0);

  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = buffer.subarray(0, headerEnd).toString('utf8');
      const lengthMatch = header.match(/content-length:\s*(\d+)/i);
      if (!lengthMatch) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (buffer.length < bodyEnd) break;

      const body = buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      buffer = buffer.subarray(bodyEnd);

      let request: McpRequest;
      try {
        request = JSON.parse(body) as McpRequest;
      } catch {
        writeMessage(jsonRpcError(undefined, -32700, 'Parse error'));
        continue;
      }

      void handleMcpRequest(request).then((response) => {
        if (request.id !== undefined) {
          writeMessage(response);
        }
      });
    }
  });

  process.stdin.resume();
}
