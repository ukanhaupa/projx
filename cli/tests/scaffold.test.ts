import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scaffold } from "../src/scaffold.js";

const REPO_DIR = join(import.meta.dirname, "../..");

describe("scaffold", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("scaffolds a project with fastify + frontend", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);

    await scaffold(
      { name: "test-app", components: ["fastify", "frontend"], git: false, install: false },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, ".projx"))).toBe(true);
    expect(existsSync(join(dest, "fastify"))).toBe(true);
    expect(existsSync(join(dest, "frontend"))).toBe(true);
    expect(existsSync(join(dest, "fastify/.projx-component"))).toBe(true);
    expect(existsSync(join(dest, "frontend/.projx-component"))).toBe(true);
  });

  it("writes correct .projx config", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);

    await scaffold(
      { name: "my-app", components: ["fastify"], git: false, install: false },
      dest,
      REPO_DIR,
    );

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.components).toEqual(["fastify"]);
    expect(config.paths).toEqual({ fastify: "fastify" });
    expect(config.version).toBe("1.1.0");
    expect(config.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("writes .projx-component markers", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);

    await scaffold(
      { name: "my-app", components: ["fastify", "frontend"], git: false, install: false },
      dest,
      REPO_DIR,
    );

    const fastifyMarker = JSON.parse(
      await readFile(join(dest, "fastify/.projx-component"), "utf-8"),
    );
    expect(fastifyMarker).toEqual({ component: "fastify" });

    const frontendMarker = JSON.parse(
      await readFile(join(dest, "frontend/.projx-component"), "utf-8"),
    );
    expect(frontendMarker).toEqual({ component: "frontend" });
  });

  it("generates docker-compose files for backend + frontend", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);

    await scaffold(
      { name: "my-app", components: ["fastify", "frontend"], git: false, install: false },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, "docker-compose.yml"))).toBe(true);
    expect(existsSync(join(dest, "docker-compose.dev.yml"))).toBe(true);
  });

  it("generates shared files", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);

    await scaffold(
      { name: "my-app", components: ["fastify"], git: false, install: false },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, "setup.sh"))).toBe(true);
    expect(existsSync(join(dest, ".githooks/pre-commit"))).toBe(true);
    expect(existsSync(join(dest, ".github/workflows/ci.yml"))).toBe(true);
    expect(existsSync(join(dest, "README.md"))).toBe(true);
  });

  it("copies static files", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);

    await scaffold(
      { name: "my-app", components: ["fastify"], git: false, install: false },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, ".editorconfig"))).toBe(true);
    expect(existsSync(join(dest, ".vscode/settings.json"))).toBe(true);
    expect(existsSync(join(dest, ".vscode/extensions.json"))).toBe(true);
  });

  it("substitutes project name in package.json", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);

    await scaffold(
      { name: "my-app", components: ["fastify"], git: false, install: false },
      dest,
      REPO_DIR,
    );

    const pkg = JSON.parse(await readFile(join(dest, "fastify/package.json"), "utf-8"));
    expect(pkg.name).toBe("my-app-fastify");
  });

  it("uses paths in generated templates", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);

    await scaffold(
      { name: "my-app", components: ["fastify"], git: false, install: false },
      dest,
      REPO_DIR,
    );

    const setup = await readFile(join(dest, "setup.sh"), "utf-8");
    expect(setup).toContain("cd fastify");

    const ci = await readFile(join(dest, ".github/workflows/ci.yml"), "utf-8");
    expect(ci).toContain("working-directory: fastify");
  });

  it("does not create docker-compose without backend or frontend", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);

    await scaffold(
      { name: "my-app", components: ["e2e"], git: false, install: false },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, "docker-compose.yml"))).toBe(false);
    expect(existsSync(join(dest, "docker-compose.dev.yml"))).toBe(false);
  });

  it("excludes lock files from template copy", async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);

    await scaffold(
      { name: "my-app", components: ["fastify"], git: false, install: false },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, "fastify/pnpm-lock.yaml"))).toBe(false);
    expect(existsSync(join(dest, "fastify/node_modules"))).toBe(false);
  });
});
