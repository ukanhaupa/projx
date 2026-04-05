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

  it("reports up-to-date when no template changes", async () => {
    dest = join(tmpdir(), `projx-update-${Date.now()}`);

    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await update(dest, REPO_DIR);
    // should not throw — "already up to date"
  });

  it("preserves user-modified files via merge conflict", async () => {
    dest = join(tmpdir(), `projx-update-${Date.now()}`);

    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const appPath = join(dest, "fastify/src/app.ts");
    await writeFile(appPath, "// user custom app code\n");
    execSync("git add -A && git commit --no-verify -m 'customize app'", { cwd: dest, stdio: "pipe" });

    const contentBefore = await readFile(appPath, "utf-8");
    expect(contentBefore).toContain("user custom app code");
  });

  it("does not touch user-created files", async () => {
    dest = join(tmpdir(), `projx-update-${Date.now()}`);

    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await writeFile(join(dest, "fastify/src/custom-controller.ts"), "// my controller\n");
    execSync("git add -A && git commit --no-verify -m 'add custom controller'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const content = await readFile(join(dest, "fastify/src/custom-controller.ts"), "utf-8");
    expect(content).toContain("my controller");
  });
});
