import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectComponents } from "../src/detect.js";
import { discoverComponentPaths, upsertComponentMarker } from "../src/utils.js";
import type { Component } from "../src/utils.js";

describe("init workflow", () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("detects components in an existing project structure", async () => {
    tmp = join(tmpdir(), `projx-init-${Date.now()}`);
    await mkdir(tmp, { recursive: true });

    await mkdir(join(tmp, "backend"));
    await writeFile(
      join(tmp, "backend/pyproject.toml"),
      '[project]\ndependencies = ["fastapi"]',
    );

    await mkdir(join(tmp, "web"));
    await writeFile(
      join(tmp, "web/package.json"),
      JSON.stringify({ dependencies: { react: "^19" } }),
    );

    await mkdir(join(tmp, "tests"));
    await writeFile(
      join(tmp, "tests/package.json"),
      JSON.stringify({ devDependencies: { "@playwright/test": "^1" } }),
    );

    const detected = await detectComponents(tmp);
    expect(detected).toHaveLength(3);

    const map = Object.fromEntries(detected.map((d) => [d.component, d.directory]));
    expect(map.fastapi).toBe("backend");
    expect(map.frontend).toBe("web");
    expect(map.e2e).toBe("tests");
  });

  it("writes markers and discovers paths correctly", async () => {
    tmp = join(tmpdir(), `projx-init-${Date.now()}`);
    await mkdir(tmp, { recursive: true });

    await mkdir(join(tmp, "backend"));
    await upsertComponentMarker(join(tmp, "backend"), "fastapi");

    await mkdir(join(tmp, "web"));
    await upsertComponentMarker(join(tmp, "web"), "frontend");

    const paths = await discoverComponentPaths(tmp, ["fastapi", "frontend"] as Component[]);
    expect(paths.fastapi).toBe("backend");
    expect(paths.frontend).toBe("web");
  });

  it("detection + marker + discovery roundtrip", async () => {
    tmp = join(tmpdir(), `projx-init-${Date.now()}`);
    await mkdir(tmp, { recursive: true });

    await mkdir(join(tmp, "backend"));
    await writeFile(
      join(tmp, "backend/package.json"),
      JSON.stringify({ dependencies: { fastify: "^5" } }),
    );

    await mkdir(join(tmp, "frontend"));
    await writeFile(
      join(tmp, "frontend/package.json"),
      JSON.stringify({ dependencies: { react: "^19" } }),
    );

    const detected = await detectComponents(tmp);
    expect(detected).toHaveLength(2);

    for (const d of detected) {
      await upsertComponentMarker(join(tmp, d.directory), d.component);
    }

    const components = detected.map((d) => d.component) as Component[];
    const paths = await discoverComponentPaths(tmp, components);
    expect(paths.fastify).toBe("backend");
    expect(paths.frontend).toBe("frontend");
  });
});
