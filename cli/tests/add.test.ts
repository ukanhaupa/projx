import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scaffold } from "../src/scaffold.js";
import { add } from "../src/add.js";

const REPO_DIR = join(import.meta.dirname, "../..");

describe("add", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("adds a new component to an existing project", async () => {
    dest = join(tmpdir(), `projx-add-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(dest, ["frontend"], REPO_DIR, true);

    expect(existsSync(join(dest, "frontend"))).toBe(true);
    expect(existsSync(join(dest, "frontend/.projx-component"))).toBe(true);
  });

  it("updates .projx config with new component", async () => {
    dest = join(tmpdir(), `projx-add-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(dest, ["e2e"], REPO_DIR, true);

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.components).toContain("fastify");
    expect(config.components).toContain("e2e");
  });

  it("regenerates shared files with all components", async () => {
    dest = join(tmpdir(), `projx-add-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(dest, ["frontend"], REPO_DIR, true);

    const ci = await readFile(join(dest, ".github/workflows/ci.yml"), "utf-8");
    expect(ci).toContain("fastify");
    expect(ci).toContain("frontend");
  });
});
