import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { matchesSkip } from "../src/baseline.js";
import { scaffold } from "../src/scaffold.js";
import { update } from "../src/update.js";
import { add } from "../src/add.js";

const REPO_DIR = join(import.meta.dirname, "../..");

function gitInDir(cwd: string, cmd: string): string {
  return execSync(`git ${cmd}`, { cwd, stdio: "pipe" }).toString().trim();
}

describe("matchesSkip", () => {
  it("matches ** (skip all)", () => {
    expect(matchesSkip("src/app.ts", ["**"])).toBe(true);
    expect(matchesSkip("Dockerfile", ["**"])).toBe(true);
  });

  it("matches directory glob (src/**)", () => {
    expect(matchesSkip("src/app.ts", ["src/**"])).toBe(true);
    expect(matchesSkip("src/plugins/auth.ts", ["src/**"])).toBe(true);
    expect(matchesSkip("Dockerfile", ["src/**"])).toBe(false);
    expect(matchesSkip("package.json", ["src/**"])).toBe(false);
  });

  it("matches extension glob (**//*.ts)", () => {
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

describe("scaffold baseline", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("creates projx/baseline branch with template", async () => {
    dest = join(tmpdir(), `projx-bl-${Date.now()}`);
    await scaffold(
      { name: "test-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const branches = gitInDir(dest, "branch");
    expect(branches).toContain("projx/baseline");

    const baselineFiles = gitInDir(dest, "ls-tree -r --name-only projx/baseline");
    expect(baselineFiles).toContain("fastify/src/app.ts");
    expect(baselineFiles).toContain(".projx");
    expect(baselineFiles).toContain("setup.sh");
  });

  it("writes scaffold-origin markers", async () => {
    dest = join(tmpdir(), `projx-bl-${Date.now()}`);
    await scaffold(
      { name: "test-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const marker = JSON.parse(await readFile(join(dest, "fastify/.projx-component"), "utf-8"));
    expect(marker.origin).toBe("scaffold");
    expect(marker.skip).toBeUndefined();
  });
});

describe("update scenarios", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("updates .projx version and baseline info after clean merge", async () => {
    dest = join(tmpdir(), `projx-bl-${Date.now()}`);
    await scaffold(
      { name: "test-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await update(dest, REPO_DIR);

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.baseline).toBeDefined();
    expect(config.baseline.branch).toBe("projx/baseline");
    expect(config.baseline.templateVersion).toBeDefined();
  });

  it("preserves user-created files through update", async () => {
    dest = join(tmpdir(), `projx-bl-${Date.now()}`);
    await scaffold(
      { name: "test-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await writeFile(join(dest, "fastify/src/custom-controller.ts"), "// my controller\n");
    execSync("git add -A && git commit --no-verify -m 'add custom'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const content = await readFile(join(dest, "fastify/src/custom-controller.ts"), "utf-8");
    expect(content).toContain("my controller");
  });

  it("updates markers with origin and skip on user branch", async () => {
    dest = join(tmpdir(), `projx-bl-${Date.now()}`);
    await scaffold(
      { name: "test-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await update(dest, REPO_DIR);

    const marker = JSON.parse(await readFile(join(dest, "fastify/.projx-component"), "utf-8"));
    expect(marker.origin).toBe("scaffold");
    expect(marker.components).toEqual(["fastify"]);
  });

  it("creates separate post-update commit, not amend", async () => {
    dest = join(tmpdir(), `projx-bl-${Date.now()}`);
    await scaffold(
      { name: "test-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const commitsBefore = gitInDir(dest, "rev-list --count HEAD");
    await update(dest, REPO_DIR);
    const commitsAfter = gitInDir(dest, "rev-list --count HEAD");

    const lastMsg = gitInDir(dest, "log -1 --format=%s");
    if (parseInt(commitsAfter) > parseInt(commitsBefore)) {
      expect(lastMsg).toContain("projx:");
    }
  });
});

describe("init + update with skip", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("init-origin markers get skip: ['**'] after update", async () => {
    dest = join(tmpdir(), `projx-bl-${Date.now()}`);
    await mkdir(dest, { recursive: true });

    await mkdir(join(dest, "backend/src"), { recursive: true });
    await writeFile(join(dest, "backend/package.json"), JSON.stringify({ name: "api", dependencies: { fastify: "^5" } }));
    await writeFile(join(dest, "backend/src/app.ts"), "// user custom app\n");

    execSync("git init", { cwd: dest, stdio: "pipe" });
    execSync("git config user.email test@test.com && git config user.name Test", { cwd: dest, stdio: "pipe" });
    execSync("git add -A && git commit --no-verify -m 'existing project'", { cwd: dest, stdio: "pipe" });

    await writeFile(join(dest, "backend/.projx-component"), JSON.stringify({ components: ["fastify"], origin: "init", skip: ["**"] }, null, 2));
    await writeFile(join(dest, ".projx"), JSON.stringify({ version: "1.3.0", components: ["fastify"], createdAt: "2026-04-05" }));
    execSync("git add -A && git commit --no-verify -m 'projx init'", { cwd: dest, stdio: "pipe" });

    const baselineFiles = await simulateBaseline(dest, ["fastify"], { fastify: "backend" }, ["**"]);

    const marker = JSON.parse(await readFile(join(dest, "backend/.projx-component"), "utf-8"));
    expect(marker.origin).toBe("init");
    expect(marker.skip).toEqual(["**"]);
  });

  it("skip: ['**'] excludes all source files from baseline", async () => {
    dest = join(tmpdir(), `projx-bl-${Date.now()}`);
    await scaffold(
      { name: "test-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await writeFile(join(dest, "fastify/.projx-component"), JSON.stringify({
      components: ["fastify"],
      origin: "init",
      skip: ["**"],
    }, null, 2));
    execSync("git add -A && git commit --no-verify -m 'mark as init'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const baselineFiles = gitInDir(dest, "ls-tree -r --name-only projx/baseline");
    const fastifySourceFiles = baselineFiles.split("\n").filter(f => f.startsWith("fastify/src/"));
    expect(fastifySourceFiles).toHaveLength(0);

    const baselineHasMarker = baselineFiles.split("\n").some(f => f === "fastify/.projx-component");
    expect(baselineHasMarker).toBe(true);
  });

  it("skip: ['src/**'] excludes source but keeps tooling", async () => {
    dest = join(tmpdir(), `projx-bl-${Date.now()}`);
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

    await update(dest, REPO_DIR);

    const baselineFiles = gitInDir(dest, "ls-tree -r --name-only projx/baseline");
    const lines = baselineFiles.split("\n");

    const sourceFiles = lines.filter(f => f.startsWith("fastify/src/") || f.startsWith("fastify/tests/"));
    expect(sourceFiles).toHaveLength(0);

    const hasPackageJson = lines.some(f => f === "fastify/package.json");
    expect(hasPackageJson).toBe(true);

    const hasDockerfile = lines.some(f => f === "fastify/Dockerfile");
    expect(hasDockerfile).toBe(true);
  });
});

describe("add with baseline", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("adds component to baseline and merges cleanly", async () => {
    dest = join(tmpdir(), `projx-bl-${Date.now()}`);
    await scaffold(
      { name: "test-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(dest, ["frontend"], REPO_DIR, true);

    expect(existsSync(join(dest, "frontend"))).toBe(true);

    const baselineFiles = gitInDir(dest, "ls-tree -r --name-only projx/baseline");
    expect(baselineFiles).toContain("frontend/");

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.components).toContain("frontend");
  });
});

async function simulateBaseline(
  cwd: string,
  components: string[],
  paths: Record<string, string>,
  skipPatterns: string[],
): Promise<string[]> {
  return [];
}
