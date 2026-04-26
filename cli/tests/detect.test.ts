import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectComponents } from "../src/detect.js";

describe("detectComponents", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-detect-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("detects fastapi from pyproject.toml", async () => {
    await mkdir(join(tmp, "backend"));
    await writeFile(
      join(tmp, "backend/pyproject.toml"),
      '[project]\ndependencies = [\n  "fastapi>=0.115",\n]',
    );

    const results = await detectComponents(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].component).toBe("fastapi");
    expect(results[0].directory).toBe("backend");
    expect(results[0].confidence).toBe("high");
  });

  it("detects fastify from package.json", async () => {
    await mkdir(join(tmp, "api"));
    await writeFile(
      join(tmp, "api/package.json"),
      JSON.stringify({ dependencies: { fastify: "^5" } }),
    );

    const results = await detectComponents(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].component).toBe("fastify");
    expect(results[0].directory).toBe("api");
  });

  it("detects react frontend from package.json", async () => {
    await mkdir(join(tmp, "web"));
    await writeFile(
      join(tmp, "web/package.json"),
      JSON.stringify({ dependencies: { react: "^19", "react-dom": "^19" } }),
    );

    const results = await detectComponents(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].component).toBe("frontend");
    expect(results[0].directory).toBe("web");
  });

  it("detects playwright e2e from package.json", async () => {
    await mkdir(join(tmp, "tests"));
    await writeFile(
      join(tmp, "tests/package.json"),
      JSON.stringify({ devDependencies: { "@playwright/test": "^1" } }),
    );

    const results = await detectComponents(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].component).toBe("e2e");
    expect(results[0].directory).toBe("tests");
  });

  it("detects flutter mobile from pubspec.yaml", async () => {
    await mkdir(join(tmp, "app"));
    await writeFile(
      join(tmp, "app/pubspec.yaml"),
      "dependencies:\n  flutter:\n    sdk: flutter\n",
    );

    const results = await detectComponents(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].component).toBe("mobile");
    expect(results[0].directory).toBe("app");
  });

  it("detects infra from .tf files", async () => {
    await mkdir(join(tmp, "terraform"));
    await writeFile(
      join(tmp, "terraform/main.tf"),
      'resource "aws_instance" {}',
    );

    const results = await detectComponents(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].component).toBe("infra");
    expect(results[0].directory).toBe("terraform");
  });

  it("detects infra from stack/ subdirectory", async () => {
    await mkdir(join(tmp, "infra/stack"), { recursive: true });
    await writeFile(join(tmp, "infra/stack/main.tf"), "");

    const results = await detectComponents(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].component).toBe("infra");
  });

  it("detects multiple components", async () => {
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
    await mkdir(join(tmp, "e2e"));
    await writeFile(
      join(tmp, "e2e/package.json"),
      JSON.stringify({ devDependencies: { "@playwright/test": "^1" } }),
    );

    const results = await detectComponents(tmp);
    expect(results).toHaveLength(3);
    const components = results.map((r) => r.component).sort();
    expect(components).toEqual(["e2e", "fastify", "frontend"]);
  });

  it("returns empty for empty directory", async () => {
    const results = await detectComponents(tmp);
    expect(results).toHaveLength(0);
  });

  it("ignores dotfiles and excluded directories", async () => {
    await mkdir(join(tmp, ".hidden"));
    await writeFile(
      join(tmp, ".hidden/package.json"),
      JSON.stringify({ dependencies: { fastify: "^5" } }),
    );
    await mkdir(join(tmp, "node_modules/something"), { recursive: true });
    await writeFile(
      join(tmp, "node_modules/something/package.json"),
      JSON.stringify({ dependencies: { react: "^19" } }),
    );

    const results = await detectComponents(tmp);
    expect(results).toHaveLength(0);
  });

  it("handles malformed package.json gracefully", async () => {
    await mkdir(join(tmp, "broken"));
    await writeFile(join(tmp, "broken/package.json"), "not json");

    const results = await detectComponents(tmp);
    expect(results).toHaveLength(0);
  });
});
