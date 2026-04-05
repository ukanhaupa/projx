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
    expect(config.components).toEqual(["fastify"]);
    expect(config.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
    expect(fastifyMarker.components).toEqual(["fastify"]);
    expect(fastifyMarker.origin).toBe("scaffold");

    const frontendMarker = JSON.parse(
      await readFile(join(dest, "frontend/.projx-component"), "utf-8"),
    );
    expect(frontendMarker.components).toEqual(["frontend"]);
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
