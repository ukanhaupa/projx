import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { scaffold } from "../src/scaffold.js";

const REPO_DIR = join(import.meta.dirname, "../..");

async function scaffoldWithGit(
  name: string,
  components: string[],
): Promise<string> {
  const dest = join(tmpdir(), `projx-update-${Date.now()}`);

  await scaffold(
    { name, components: components as any, git: false, install: false },
    dest,
    REPO_DIR,
  );

  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync("git config core.hooksPath .githooks", { cwd: dest, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dest, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dest, stdio: "pipe" });
  execSync("git add -A", { cwd: dest, stdio: "pipe" });
  execSync('git commit -m "init" --no-verify', { cwd: dest, stdio: "pipe" });

  return dest;
}

describe("update", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("discovers renamed component via .projx-component marker", async () => {
    dest = await scaffoldWithGit("my-app", ["fastify"]);

    await rename(join(dest, "fastify"), join(dest, "backend"));

    execSync("git add -A", { cwd: dest, stdio: "pipe" });
    execSync('git commit -m "rename fastify to backend" --no-verify', { cwd: dest, stdio: "pipe" });

    const { discoverComponentPaths } = await import("../src/utils.js");
    const paths = await discoverComponentPaths(dest, ["fastify"]);
    expect(paths.fastify).toBe("backend");
  });

  it("preserves .projx-component during update overlay", async () => {
    dest = await scaffoldWithGit("my-app", ["fastify", "frontend"]);

    const marker = JSON.parse(
      await readFile(join(dest, "fastify/.projx-component"), "utf-8"),
    );
    expect(marker).toEqual({ component: "fastify" });
  });

  it("detects project name from renamed directory", async () => {
    dest = await scaffoldWithGit("my-app", ["fastify"]);

    await rename(join(dest, "fastify"), join(dest, "api"));

    execSync("git add -A", { cwd: dest, stdio: "pipe" });
    execSync('git commit -m "rename" --no-verify', { cwd: dest, stdio: "pipe" });

    const { discoverComponentPaths } = await import("../src/utils.js");
    const paths = await discoverComponentPaths(dest, ["fastify"]);
    expect(paths.fastify).toBe("api");

    const pkgPath = join(dest, "api/package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    expect(pkg.name).toBe("my-app-fastify");
  });
});
