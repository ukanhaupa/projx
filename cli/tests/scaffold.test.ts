import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scaffold } from "../src/scaffold.js";
import * as utilsModule from "../src/utils.js";
import { type PackageManager, pmCommands } from "../src/utils.js";

const REPO_DIR = join(import.meta.dirname, "../..");

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("scaffold", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("scaffolds a project with fastify + frontend", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      {
        name: "test-app",
        components: ["fastify", "frontend"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, ".projx"))).toBe(true);
    expect(existsSync(join(dest, "fastify"))).toBe(true);
    expect(existsSync(join(dest, "frontend"))).toBe(true);
  });

  it("writes correct .projx config", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.version).toBeTruthy();
    expect(config.components).toBeUndefined();
    expect(config.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(config.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(config.defaultsApplied).toBe(true);
    expect(config.skip).toContain("docker-compose.yml");
    expect(config.skip).toContain("docker-compose.dev.yml");
    expect(config.skip).toContain("README.md");
  });

  it("writes .projx-component markers", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      {
        name: "my-app",
        components: ["fastify", "frontend"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const fastifyMarker = JSON.parse(
      await readFile(join(dest, "fastify/.projx-component"), "utf-8"),
    );
    expect(fastifyMarker.component).toBe("fastify");
    expect(fastifyMarker.skip).toContain("package.json");
    expect(fastifyMarker.origin).toBeUndefined();

    const frontendMarker = JSON.parse(
      await readFile(join(dest, "frontend/.projx-component"), "utf-8"),
    );
    expect(frontendMarker.component).toBe("frontend");
  });

  it("generates shared files", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, "scripts/setup.sh"))).toBe(true);
    expect(existsSync(join(dest, ".githooks/pre-commit"))).toBe(true);
    expect(existsSync(join(dest, ".github/workflows/ci.yml"))).toBe(true);
    expect(existsSync(join(dest, "README.md"))).toBe(true);
    expect(existsSync(join(dest, ".vscode/settings.json"))).toBe(true);
  });

  it("ci.yml uses canonical display names (FastAPI, Fastify, Frontend, Flutter)", async () => {
    dest = join(tmpdir(), `projx-display-${Date.now()}`);
    await scaffold(
      {
        name: "display-app",
        components: ["fastapi", "fastify", "frontend", "mobile"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const ci = await readFile(join(dest, ".github/workflows/ci.yml"), "utf-8");
    expect(ci).toContain("name: FastAPI (format + lint + typecheck + audit)");
    expect(ci).toContain(
      "name: Fastify (format + lint + typecheck + build + audit)",
    );
    expect(ci).toContain(
      "name: Frontend (format + lint + typecheck + build + audit)",
    );
    expect(ci).toContain("name: Flutter (format + analyze + test + coverage)");
    expect(ci).toContain("name: Secret scan");
    expect(ci).toContain("gitleaks/gitleaks-action@v2");
    expect(ci).toMatch(/^permissions:\n\s+contents: read\n\s+pull-requests: read/m);
    expect(ci).toContain("image: postgres:16");
    expect(ci).toContain("DATABASE_URL: postgresql://postgres:postgres@localhost");
    expect(ci).toContain(
      "SQLALCHEMY_DATABASE_URI: postgresql+asyncpg://postgres:postgres@localhost",
    );
    expect(ci).toContain("prisma migrate deploy");
    expect(ci).toMatch(/node-version: 22[\s\S]+node-version: 22/);
    expect(ci).not.toContain("node-version: 20");
    expect(ci).toContain("bash scripts/check-bundle-size.sh");
  });

  it("setup.sh uses canonical display names", async () => {
    dest = join(tmpdir(), `projx-setup-display-${Date.now()}`);
    await scaffold(
      {
        name: "display-app",
        components: ["fastapi", "fastify", "frontend"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const setup = await readFile(join(dest, "scripts/setup.sh"), "utf-8");
    expect(setup).toContain("FastAPI dependencies installed.");
    expect(setup).toContain("Fastify dependencies installed.");
    expect(setup).toContain("Frontend dependencies installed.");
  });

  it("substitutes project name in package.json", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const pkg = JSON.parse(
      await readFile(join(dest, "fastify/package.json"), "utf-8"),
    );
    expect(pkg.name).toBe("my-app-fastify");
  });

  it("defaults to npm when no packageManager specified", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      { name: "npm-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.packageManager).toBe("npm");
  });

  it("does not create docker-compose without backend or frontend", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["e2e"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, "docker-compose.yml"))).toBe(false);
  });

  it("creates project without git when opts.git is false", async () => {
    dest = join(tmpdir(), `projx-scaffold-no-git-${Date.now()}`);
    await scaffold(
      { name: "no-git", components: ["fastify"], git: false, install: false },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, "fastify"))).toBe(true);
    expect(existsSync(join(dest, ".git"))).toBe(false);
  });

  it("copies .env.example to .env after scaffolding", async () => {
    dest = join(tmpdir(), `projx-scaffold-env-${Date.now()}`);
    await scaffold(
      { name: "env-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, "fastify/.env.example"))).toBe(true);
    expect(existsSync(join(dest, "fastify/.env"))).toBe(true);
  });
});

describe("scaffold install paths (mocked)", () => {
  let dest: string;
  let execSpy: ReturnType<typeof vi.spyOn>;
  let hasCommandSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execSpy = vi.spyOn(utilsModule, "exec").mockImplementation(() => "");
    hasCommandSpy = vi.spyOn(utilsModule, "hasCommand");
  });

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("runs install commands for each js component when tool is on PATH", async () => {
    dest = join(tmpdir(), `projx-scaffold-install-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      {
        name: "install-app",
        components: ["fastify", "frontend", "e2e", "fastapi", "mobile"],
        git: false,
        install: true,
        packageManager: "npm",
      },
      dest,
      REPO_DIR,
    );

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes("uv sync"))).toBe(true);
    expect(calls.filter((c) => c.includes("npm install")).length).toBeGreaterThanOrEqual(3);
    expect(calls.some((c) => c.includes("flutter pub get"))).toBe(true);
  });

  it("falls back to warn message when package manager is missing", async () => {
    dest = join(tmpdir(), `projx-scaffold-missing-${Date.now()}`);
    hasCommandSpy.mockReturnValue(false);

    await scaffold(
      {
        name: "no-tool",
        components: ["fastify", "frontend", "fastapi", "mobile"],
        git: false,
        install: true,
        packageManager: "pnpm",
      },
      dest,
      REPO_DIR,
    );

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes("pnpm install"))).toBe(false);
    expect(calls.some((c) => c.includes("flutter pub get"))).toBe(false);
    expect(calls.some((c) => c.includes("uv sync"))).toBe(false);
    expect(existsSync(join(dest, "fastify"))).toBe(true);
  });

  it("install: true with infra-only is a no-op for installs", async () => {
    dest = join(tmpdir(), `projx-scaffold-infra-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      {
        name: "infra-only",
        components: ["infra"],
        git: false,
        install: true,
      },
      dest,
      REPO_DIR,
    );

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes("install"))).toBe(false);
    expect(calls.some((c) => c.includes("flutter"))).toBe(false);
  });
});

const PMS: PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

describe.each(PMS)("scaffold with %s", (pm) => {
  let dest: string;
  const cmd = pmCommands(pm);

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("stores packageManager in .projx", async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ["fastify", "frontend"],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.packageManager).toBe(pm);
  });

  it("setup.sh uses correct install command", async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ["fastify", "frontend"],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const setup = await readFile(join(dest, "scripts/setup.sh"), "utf-8");
    expect(setup).toMatch(new RegExp(`^  ${escapeRegex(cmd.install)}$`, "m"));
  });

  it("setup.sh wraps each install block in a subshell so failures abort the script", async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ["fastify", "frontend"],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const setup = await readFile(join(dest, "scripts/setup.sh"), "utf-8");
    expect(setup).not.toContain("&& cd ..");
    expect(setup).toMatch(/\(\n\s+cd fastify\n\s+\S+/);
    expect(setup).toMatch(/\(\n\s+cd frontend\n\s+\S+/);
  });

  it("README uses correct commands", async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ["fastify", "frontend"],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const readme = await readFile(join(dest, "README.md"), "utf-8");
    expect(readme).toContain(cmd.install);
    expect(readme).toContain(cmd.run);
  });

  it("docker-compose.dev.yml uses correct commands", async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ["fastify", "frontend"],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const dc = await readFile(join(dest, "docker-compose.dev.yml"), "utf-8");
    expect(dc).toContain(cmd.prismaExec);
    expect(dc).toContain(cmd.runDev);
    expect(dc).toContain(cmd.install);
  });

  it("docker-compose.yml uses correct prisma command", async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ["fastify"],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const dc = await readFile(join(dest, "docker-compose.yml"), "utf-8");
    expect(dc).toContain(cmd.prismaExec);
  });

  it("CI workflow uses correct setup and install", async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ["fastify", "frontend", "e2e"],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const ci = await readFile(join(dest, ".github/workflows/ci.yml"), "utf-8");
    expect(ci).toContain(cmd.ci);
    expect(ci).toContain(cmd.prismaExec);
    expect(ci).toContain(cmd.audit);
    expect(ci).toContain("gitleaks/gitleaks-action@v2");

    if (pm === "pnpm") {
      expect(ci).toContain("pnpm/action-setup@v4");
    }
    if (pm === "bun") {
      expect(ci).toContain("oven-sh/setup-bun@v2");
      expect(ci).not.toContain("actions/setup-node@v5");
    }
    if (pm === "npm" || pm === "yarn") {
      expect(ci).not.toContain("pnpm/action-setup");
      expect(ci).not.toContain("oven-sh/setup-bun");
      expect(ci).toContain("actions/setup-node@v5");
    }
  });

  it("pre-commit hook uses correct exec command", async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ["fastify", "frontend"],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const hook = await readFile(join(dest, ".githooks/pre-commit"), "utf-8");
    expect(hook).toContain(`${cmd.exec} prettier`);
    expect(hook).toContain(`${cmd.exec} eslint`);
    expect(hook).toContain(`${cmd.exec} tsc`);
  });

  it("pre-commit hook does not run pip-audit (moved to CI)", async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ["fastapi"],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const hook = await readFile(join(dest, ".githooks/pre-commit"), "utf-8");
    expect(hook).not.toContain("pip-audit");

    const ci = await readFile(join(dest, ".github/workflows/ci.yml"), "utf-8");
    expect(ci).toContain("pip-audit");
  });

  it("frontend Dockerfile uses the correct install and run commands", async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ["frontend"],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const dockerfile = await readFile(
      join(dest, "frontend/Dockerfile"),
      "utf-8",
    );
    expect(existsSync(join(dest, "frontend/Dockerfile.ejs"))).toBe(false);
    expect(dockerfile).toContain(cmd.ci);
    expect(dockerfile).toContain(`${cmd.run} build`);
    expect(dockerfile).toContain(cmd.lockfile);
    if (pm === "bun") {
      expect(dockerfile).toContain("oven/bun");
    } else {
      expect(dockerfile).toContain("node:20-alpine");
    }
  });

  it("fastify Dockerfile uses the correct install, prisma, and run commands", async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ["fastify"],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const dockerfile = await readFile(
      join(dest, "fastify/Dockerfile"),
      "utf-8",
    );
    expect(existsSync(join(dest, "fastify/Dockerfile.ejs"))).toBe(false);
    expect(dockerfile).toContain(cmd.ci);
    expect(dockerfile).toContain(`${cmd.prismaExec} generate`);
    expect(dockerfile).toContain(`${cmd.run} build`);
    expect(dockerfile).toContain(cmd.lockfile);
  });
});
