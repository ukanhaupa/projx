import { describe, it, afterEach } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { scaffold } from "../src/scaffold.js";
import { diff } from "../src/diff.js";

const REPO_DIR = join(import.meta.dirname, "../..");

describe("diff", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("runs without error on up-to-date project", async () => {
    dest = join(tmpdir(), `projx-diff-uptodate-${Date.now()}`);
    await scaffold(
      { name: "diff-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await diff(dest, REPO_DIR);
  });

  it("runs without error when user has modifications", async () => {
    dest = join(tmpdir(), `projx-diff-mods-${Date.now()}`);
    await scaffold(
      { name: "diff-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const pkgPath = join(dest, "fastify/package.json");
    let pkg = await readFile(pkgPath, "utf-8");
    pkg = pkg.replace('"description":', '"custom": true,\n  "description":');
    await writeFile(pkgPath, pkg);
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'user mod'",
      { cwd: dest, stdio: "pipe" },
    );

    await diff(dest, REPO_DIR);
  });

  it("runs with multiple components", async () => {
    dest = join(tmpdir(), `projx-diff-multi-${Date.now()}`);
    await scaffold(
      {
        name: "diff-app",
        components: ["fastify", "e2e"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await diff(dest, REPO_DIR);
  });

  it("runs with skip patterns set", async () => {
    dest = join(tmpdir(), `projx-diff-skip-${Date.now()}`);
    await scaffold(
      { name: "diff-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const markerPath = join(dest, "fastify/.projx-component");
    const marker = JSON.parse(await readFile(markerPath, "utf-8"));
    marker.skip = ["src/**"];
    await writeFile(markerPath, JSON.stringify(marker, null, 2) + "\n");
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'set skip'",
      { cwd: dest, stdio: "pipe" },
    );

    await diff(dest, REPO_DIR);
  });
});
