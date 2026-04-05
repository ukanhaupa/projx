import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { scaffold } from "../src/scaffold.js";
import { update } from "../src/update.js";

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
});
