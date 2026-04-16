import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scaffold } from "../src/scaffold.js";
import { type PackageManager, pmCommands } from "../src/utils.js";

const REPO_DIR = join(import.meta.dirname, "../..");

describe("scaffold", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("scaffolds a project with fastify + frontend", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      { name: "test-app", components: ["fastify", "frontend"], git: true, install: false },
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
      { name: "my-app", components: ["fastify", "frontend"], git: true, install: false },
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

    expect(existsSync(join(dest, "setup.sh"))).toBe(true);
    expect(existsSync(join(dest, ".githooks/pre-commit"))).toBe(true);
    expect(existsSync(join(dest, ".github/workflows/ci.yml"))).toBe(true);
    expect(existsSync(join(dest, "README.md"))).toBe(true);
    expect(existsSync(join(dest, ".vscode/settings.json"))).toBe(true);
  });

  it("ci.yml uses canonical display names (FastAPI, Fastify, Frontend, Flutter)", async () => {
    dest = join(tmpdir(), `projx-display-${Date.now()}`);
    await scaffold(
      { name: "display-app", components: ["fastapi", "fastify", "frontend", "mobile"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const ci = await readFile(join(dest, ".github/workflows/ci.yml"), "utf-8");
    expect(ci).toContain("name: FastAPI (format + lint + typecheck + test + audit)");
    expect(ci).toContain("name: Fastify (format + lint + typecheck)");
    expect(ci).toContain("name: Frontend (format + lint + typecheck)");
    expect(ci).toContain("name: Flutter (format + analyze)");
  });

  it("setup.sh uses canonical display names", async () => {
    dest = join(tmpdir(), `projx-setup-display-${Date.now()}`);
    await scaffold(
      { name: "display-app", components: ["fastapi", "fastify", "frontend"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const setup = await readFile(join(dest, "setup.sh"), "utf-8");
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

    const pkg = JSON.parse(await readFile(join(dest, "fastify/package.json"), "utf-8"));
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
      { name: `${pm}-app`, components: ["fastify", "frontend"], git: true, install: false, packageManager: pm },
      dest,
      REPO_DIR,
    );

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.packageManager).toBe(pm);
  });

  it("setup.sh uses correct install command", async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      { name: `${pm}-app`, components: ["fastify", "frontend"], git: true, install: false, packageManager: pm },
      dest,
      REPO_DIR,
    );

    const setup = await readFile(join(dest, "setup.sh"), "utf-8");
    expect(setup).toContain(cmd.ci);

    for (const other of PMS.filter((p) => p !== pm)) {
      const otherCmd = pmCommands(other);
      if (otherCmd.ci !== cmd.ci) {
        expect(setup).not.toContain(otherCmd.ci);
      }
    }
  });

  it("README uses correct commands", async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      { name: `${pm}-app`, components: ["fastify", "frontend"], git: true, install: false, packageManager: pm },
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
      { name: `${pm}-app`, components: ["fastify", "frontend"], git: true, install: false, packageManager: pm },
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
      { name: `${pm}-app`, components: ["fastify"], git: true, install: false, packageManager: pm },
      dest,
      REPO_DIR,
    );

    const dc = await readFile(join(dest, "docker-compose.yml"), "utf-8");
    expect(dc).toContain(cmd.prismaExec);
  });

  it("CI workflow uses correct setup and install", async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      { name: `${pm}-app`, components: ["fastify", "frontend", "e2e"], git: true, install: false, packageManager: pm },
      dest,
      REPO_DIR,
    );

    const ci = await readFile(join(dest, ".github/workflows/ci.yml"), "utf-8");
    expect(ci).toContain(cmd.ci);
    expect(ci).toContain(cmd.prismaExec);

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
      { name: `${pm}-app`, components: ["fastify", "frontend"], git: true, install: false, packageManager: pm },
      dest,
      REPO_DIR,
    );

    const hook = await readFile(join(dest, ".githooks/pre-commit"), "utf-8");
    expect(hook).toContain(`${cmd.exec} prettier`);
    expect(hook).toContain(`${cmd.exec} eslint`);
    expect(hook).toContain(`${cmd.exec} tsc`);
  });
});
