import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { scaffold } from "../src/scaffold.js";
import { update, learnSkips } from "../src/update.js";
import type { ComponentPaths } from "../src/utils.js";

const REPO_DIR = join(import.meta.dirname, "../..");

describe("update", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("preserves user-created files through update", async () => {
    dest = join(tmpdir(), `projx-update-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await writeFile(join(dest, "fastify/src/custom-controller.ts"), "// my controller\n");
    execSync("git add -A && git commit --no-verify -m 'add custom'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const content = await readFile(join(dest, "fastify/src/custom-controller.ts"), "utf-8");
    expect(content).toContain("my controller");
  });

  it("merge actually creates a commit with template files", async () => {
    dest = join(tmpdir(), `projx-update-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const commitsBefore = parseInt(
      execSync("git rev-list --count HEAD", { cwd: dest, stdio: "pipe" }).toString().trim()
    );

    await update(dest, REPO_DIR);

    const commitsAfter = parseInt(
      execSync("git rev-list --count HEAD", { cwd: dest, stdio: "pipe" }).toString().trim()
    );
    expect(commitsAfter).toBeGreaterThan(commitsBefore);
  });

  it("produces single merge commit", async () => {
    dest = join(tmpdir(), `projx-update-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const commitsBefore = parseInt(
      execSync("git rev-list --count HEAD", { cwd: dest, stdio: "pipe" }).toString().trim()
    );

    await update(dest, REPO_DIR);

    const commitsAfter = parseInt(
      execSync("git rev-list --count HEAD", { cwd: dest, stdio: "pipe" }).toString().trim()
    );

    expect(commitsAfter - commitsBefore).toBeLessThanOrEqual(2);
  });

  it("learnSkips adds component files to component marker skip list", async () => {
    dest = join(tmpdir(), `projx-learn-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify", "frontend"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const paths: ComponentPaths = {
      fastapi: "fastapi",
      fastify: "fastify",
      frontend: "frontend",
      mobile: "mobile",
      e2e: "e2e",
      infra: "infra",
    };

    await learnSkips(
      dest,
      ["fastify/src/server.ts", "fastify/src/plugins/auth.ts", "frontend/src/App.tsx"],
      paths,
    );

    const fastifyMarker = JSON.parse(
      await readFile(join(dest, "fastify/.projx-component"), "utf-8"),
    );
    expect(fastifyMarker.skip).toContain("src/server.ts");
    expect(fastifyMarker.skip).toContain("src/plugins/auth.ts");

    const frontendMarker = JSON.parse(
      await readFile(join(dest, "frontend/.projx-component"), "utf-8"),
    );
    expect(frontendMarker.skip).toContain("src/App.tsx");
  });

  it("learnSkips adds root files to .projx skip list", async () => {
    dest = join(tmpdir(), `projx-learn-root-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const paths: ComponentPaths = {
      fastapi: "fastapi",
      fastify: "fastify",
      frontend: "frontend",
      mobile: "mobile",
      e2e: "e2e",
      infra: "infra",
    };

    await learnSkips(dest, ["docker-compose.yml", "README.md"], paths);

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.skip).toContain("docker-compose.yml");
    expect(config.skip).toContain("README.md");
  });

  it("learnSkips preserves existing skip entries", async () => {
    dest = join(tmpdir(), `projx-learn-preserve-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const markerPath = join(dest, "fastify/.projx-component");
    const marker = JSON.parse(await readFile(markerPath, "utf-8"));
    marker.skip = ["src/existing.ts"];
    await writeFile(markerPath, JSON.stringify(marker, null, 2) + "\n");

    const paths: ComponentPaths = {
      fastapi: "fastapi",
      fastify: "fastify",
      frontend: "frontend",
      mobile: "mobile",
      e2e: "e2e",
      infra: "infra",
    };

    await learnSkips(dest, ["fastify/src/new-file.ts"], paths);

    const updated = JSON.parse(await readFile(markerPath, "utf-8"));
    expect(updated.skip).toContain("src/existing.ts");
    expect(updated.skip).toContain("src/new-file.ts");
  });
});
