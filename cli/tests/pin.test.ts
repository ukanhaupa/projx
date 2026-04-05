import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scaffold } from "../src/scaffold.js";
import { pin, unpin } from "../src/pin.js";

const REPO_DIR = join(import.meta.dirname, "../..");

describe("pin", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("pins a root-level file to .projx skip", async () => {
    dest = join(tmpdir(), `projx-pin-root-${Date.now()}`);
    await scaffold(
      { name: "pin-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await pin(dest, ["README.md", "docker-compose.yml"]);

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.skip).toContain("README.md");
    expect(config.skip).toContain("docker-compose.yml");
  });

  it("pins a component file to component marker skip", async () => {
    dest = join(tmpdir(), `projx-pin-comp-${Date.now()}`);
    await scaffold(
      { name: "pin-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await pin(dest, ["fastify/src/app.ts", "fastify/Dockerfile"]);

    const marker = JSON.parse(
      await readFile(join(dest, "fastify/.projx-component"), "utf-8"),
    );
    expect(marker.skip).toContain("src/app.ts");
    expect(marker.skip).toContain("Dockerfile");
  });

  it("does not duplicate existing patterns", async () => {
    dest = join(tmpdir(), `projx-pin-dedup-${Date.now()}`);
    await scaffold(
      { name: "pin-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await pin(dest, ["README.md"]);
    await pin(dest, ["README.md"]);

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    const count = config.skip.filter((s: string) => s === "README.md").length;
    expect(count).toBe(1);
  });

  it("rejects pinning .projx config files", async () => {
    dest = join(tmpdir(), `projx-pin-reject-${Date.now()}`);
    await scaffold(
      { name: "pin-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await pin(dest, [".projx"]);

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.skip).toBeUndefined();
  });

  it("pins glob patterns", async () => {
    dest = join(tmpdir(), `projx-pin-glob-${Date.now()}`);
    await scaffold(
      { name: "pin-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await pin(dest, ["fastify/src/**"]);

    const marker = JSON.parse(
      await readFile(join(dest, "fastify/.projx-component"), "utf-8"),
    );
    expect(marker.skip).toContain("src/**");
  });
});

describe("unpin", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("removes a pinned root pattern", async () => {
    dest = join(tmpdir(), `projx-unpin-root-${Date.now()}`);
    await scaffold(
      { name: "unpin-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await pin(dest, ["README.md", "docker-compose.yml"]);
    await unpin(dest, ["README.md"]);

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.skip).not.toContain("README.md");
    expect(config.skip).toContain("docker-compose.yml");
  });

  it("removes a pinned component pattern", async () => {
    dest = join(tmpdir(), `projx-unpin-comp-${Date.now()}`);
    await scaffold(
      { name: "unpin-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await pin(dest, ["fastify/src/app.ts", "fastify/Dockerfile"]);
    await unpin(dest, ["fastify/src/app.ts"]);

    const marker = JSON.parse(
      await readFile(join(dest, "fastify/.projx-component"), "utf-8"),
    );
    expect(marker.skip).not.toContain("src/app.ts");
    expect(marker.skip).toContain("Dockerfile");
  });

  it("removes skip field when last pattern unpinned", async () => {
    dest = join(tmpdir(), `projx-unpin-last-${Date.now()}`);
    await scaffold(
      { name: "unpin-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await pin(dest, ["README.md"]);
    await unpin(dest, ["README.md"]);

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.skip).toBeUndefined();
  });
});
