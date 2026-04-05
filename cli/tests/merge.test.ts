import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, readFile, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { scaffold } from "../src/scaffold.js";
import { discoverComponentPaths } from "../src/utils.js";
import type { Component } from "../src/utils.js";

const REPO_DIR = join(import.meta.dirname, "../..");

describe("update merge behavior", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("package.json merge preserves user deps and adds template deps", async () => {
    dest = join(tmpdir(), `projx-merge-${Date.now()}`);

    await scaffold(
      { name: "my-app", components: ["fastify"], git: false, install: false },
      dest,
      REPO_DIR,
    );

    const pkgPath = join(dest, "fastify/package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    pkg.dependencies["custom-lib"] = "^1.0.0";
    pkg.devDependencies["custom-dev-lib"] = "^2.0.0";
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2));

    const after = JSON.parse(await readFile(pkgPath, "utf-8"));
    expect(after.dependencies["custom-lib"]).toBe("^1.0.0");
    expect(after.dependencies.fastify).toBeDefined();
    expect(after.devDependencies["custom-dev-lib"]).toBe("^2.0.0");
  });

  it("skips overlay when two components share the same directory", async () => {
    dest = join(tmpdir(), `projx-nest-${Date.now()}`);
    await mkdir(dest, { recursive: true });

    await mkdir(join(dest, "frontend"));
    const { writeComponentMarker } = await import("../src/utils.js");
    await writeComponentMarker(join(dest, "frontend"), "frontend");
    await writeComponentMarker(join(dest, "frontend"), "e2e");

    const paths = await discoverComponentPaths(dest, ["frontend", "e2e"] as Component[]);
    expect(paths.frontend).toBe("frontend");
    expect(paths.e2e).toBe("frontend");
  });

  it("discovers renamed paths after scaffold + rename", async () => {
    dest = join(tmpdir(), `projx-rename-${Date.now()}`);

    await scaffold(
      { name: "my-app", components: ["fastify", "frontend"], git: false, install: false },
      dest,
      REPO_DIR,
    );

    await rename(join(dest, "fastify"), join(dest, "api"));

    const paths = await discoverComponentPaths(dest, ["fastify", "frontend"] as Component[]);
    expect(paths.fastify).toBe("api");
    expect(paths.frontend).toBe("frontend");
  });
});
