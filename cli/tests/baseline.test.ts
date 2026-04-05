import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { matchesSkip } from "../src/baseline.js";
import { scaffold } from "../src/scaffold.js";
import { update } from "../src/update.js";

const REPO_DIR = join(import.meta.dirname, "../..");

describe("matchesSkip", () => {
  it("matches ** (skip all)", () => {
    expect(matchesSkip("src/app.ts", ["**"])).toBe(true);
    expect(matchesSkip("Dockerfile", ["**"])).toBe(true);
  });

  it("matches directory glob (src/**)", () => {
    expect(matchesSkip("src/app.ts", ["src/**"])).toBe(true);
    expect(matchesSkip("src/plugins/auth.ts", ["src/**"])).toBe(true);
    expect(matchesSkip("Dockerfile", ["src/**"])).toBe(false);
  });

  it("matches extension glob (**/*.ts)", () => {
    expect(matchesSkip("src/app.ts", ["**/*.ts"])).toBe(true);
    expect(matchesSkip("deep/nested/file.ts", ["**/*.ts"])).toBe(true);
    expect(matchesSkip("package.json", ["**/*.ts"])).toBe(false);
  });

  it("matches extension shorthand (*.ts)", () => {
    expect(matchesSkip("app.ts", ["*.ts"])).toBe(true);
    expect(matchesSkip("src/app.ts", ["*.ts"])).toBe(true);
    expect(matchesSkip("app.json", ["*.ts"])).toBe(false);
  });

  it("matches exact file", () => {
    expect(matchesSkip("Dockerfile", ["Dockerfile"])).toBe(true);
    expect(matchesSkip("package.json", ["Dockerfile"])).toBe(false);
  });

  it("matches multiple patterns", () => {
    expect(matchesSkip("src/app.ts", ["src/**", "tests/**"])).toBe(true);
    expect(matchesSkip("tests/app.test.ts", ["src/**", "tests/**"])).toBe(true);
    expect(matchesSkip("Dockerfile", ["src/**", "tests/**"])).toBe(false);
  });

  it("returns false for empty patterns", () => {
    expect(matchesSkip("src/app.ts", [])).toBe(false);
  });
});

describe("skip patterns in update", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("skip: ['src/**'] excludes source from template overlay", async () => {
    dest = join(tmpdir(), `projx-skip-${Date.now()}`);
    await scaffold(
      { name: "test-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await writeFile(join(dest, "fastify/.projx-component"), JSON.stringify({
      components: ["fastify"],
      origin: "init",
      skip: ["src/**", "tests/**"],
    }, null, 2));
    execSync("git add -A && git commit --no-verify -m 'set skip'", { cwd: dest, stdio: "pipe" });

    await writeFile(join(dest, "fastify/src/custom.ts"), "// custom\n");
    execSync("git add -A && git commit --no-verify -m 'add custom'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const custom = await readFile(join(dest, "fastify/src/custom.ts"), "utf-8");
    expect(custom).toContain("custom");
  });

  it("skip: [] overlays everything", async () => {
    dest = join(tmpdir(), `projx-noskip-${Date.now()}`);
    await scaffold(
      { name: "test-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await writeFile(join(dest, "fastify/.projx-component"), JSON.stringify({
      components: ["fastify"],
      origin: "scaffold",
      skip: [],
    }, null, 2));
    execSync("git add -A && git commit --no-verify -m 'set no skip'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    expect(existsSync(join(dest, "fastify/src/app.ts"))).toBe(true);
  });
});
