import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scaffold } from "../src/scaffold.js";
import { add } from "../src/add.js";
import * as utilsModule from "../src/utils.js";

const REPO_DIR = join(import.meta.dirname, "../..");

describe("add", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("adds a new component to an existing project", async () => {
    dest = join(tmpdir(), `projx-add-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(dest, ["frontend"], REPO_DIR, true);

    expect(existsSync(join(dest, "frontend"))).toBe(true);
    expect(existsSync(join(dest, "frontend/.projx-component"))).toBe(true);
  });

  it("registers new component via .projx-component marker", async () => {
    dest = join(tmpdir(), `projx-add-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(dest, ["e2e"], REPO_DIR, true);

    const fastifyMarker = JSON.parse(
      await readFile(join(dest, "fastify/.projx-component"), "utf-8"),
    );
    expect(fastifyMarker.component).toBe("fastify");

    const e2eMarker = JSON.parse(
      await readFile(join(dest, "e2e/.projx-component"), "utf-8"),
    );
    expect(e2eMarker.component).toBe("e2e");
  });

  it("regenerates shared files with all components", async () => {
    dest = join(tmpdir(), `projx-add-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(dest, ["frontend"], REPO_DIR, true);

    const ci = await readFile(join(dest, ".github/workflows/ci.yml"), "utf-8");
    expect(ci).toContain("fastify");
    expect(ci).toContain("frontend");
  });

  describe("--name flag", () => {
    it("creates a second instance of the same type at a custom directory", async () => {
      dest = join(tmpdir(), `projx-add-name-${Date.now()}`);
      await scaffold(
        { name: "my-app", components: ["fastify"], git: true, install: false },
        dest,
        REPO_DIR,
      );

      await add(dest, ["fastify"], REPO_DIR, true, "email-ingestor");

      expect(existsSync(join(dest, "fastify"))).toBe(true);
      expect(existsSync(join(dest, "email-ingestor"))).toBe(true);
      expect(existsSync(join(dest, "email-ingestor/.projx-component"))).toBe(
        true,
      );

      const marker = JSON.parse(
        await readFile(join(dest, "email-ingestor/.projx-component"), "utf-8"),
      );
      expect(marker.component).toBe("fastify");
    });

    it("emits CI / pre-commit / setup blocks for both instances", async () => {
      dest = join(tmpdir(), `projx-add-name-templates-${Date.now()}`);
      await scaffold(
        { name: "my-app", components: ["fastify"], git: true, install: false },
        dest,
        REPO_DIR,
      );

      await add(dest, ["fastify"], REPO_DIR, true, "email-ingestor");

      const ci = await readFile(
        join(dest, ".github/workflows/ci.yml"),
        "utf-8",
      );
      expect(ci).toContain("fastify:");
      expect(ci).toContain("email-ingestor:");
      expect(ci).toContain("'fastify/**'");
      expect(ci).toContain("'email-ingestor/**'");

      const hook = await readFile(join(dest, ".githooks/pre-commit"), "utf-8");
      expect(hook).toContain("Formatting fastify");
      expect(hook).toContain("Formatting email-ingestor");

      const setup = await readFile(join(dest, "scripts/setup.sh"), "utf-8");
      expect(setup).toMatch(/\(\n\s+cd fastify\n/);
      expect(setup).toMatch(/\(\n\s+cd email-ingestor\n/);

      const compose = await readFile(join(dest, "docker-compose.yml"), "utf-8");
      expect(compose).toContain("fastify:");
      expect(compose).toContain("fastify-migrate:");
      expect(compose).toContain("email-ingestor:");
      expect(compose).toContain("email-ingestor-migrate:");
    });

    it("does not modify existing component dirs (preserves user customizations)", async () => {
      dest = join(tmpdir(), `projx-add-name-preserve-${Date.now()}`);
      await scaffold(
        { name: "my-app", components: ["fastify"], git: true, install: false },
        dest,
        REPO_DIR,
      );

      // Simulate a user customization by replacing a tracked file
      const userCode = "// CUSTOM USER CODE — must not be clobbered\n";
      await writeFile(join(dest, "fastify/src/app.ts"), userCode);
      const userPkg = '{"name":"my-custom","scripts":{"foo":"bar"}}\n';
      await writeFile(join(dest, "fastify/package.json"), userPkg);

      await add(dest, ["fastify"], REPO_DIR, true, "email-ingestor");

      expect(await readFile(join(dest, "fastify/src/app.ts"), "utf-8")).toBe(
        userCode,
      );
      expect(await readFile(join(dest, "fastify/package.json"), "utf-8")).toBe(
        userPkg,
      );
    });

    it("respects .projx skip list — does not overwrite skipped root files", async () => {
      dest = join(tmpdir(), `projx-add-name-rootskip-${Date.now()}`);
      await scaffold(
        { name: "my-app", components: ["fastify"], git: true, install: false },
        dest,
        REPO_DIR,
      );

      const projxPath = join(dest, ".projx");
      const projx = JSON.parse(await readFile(projxPath, "utf-8"));
      projx.skip = [...(projx.skip ?? []), "README.md"];
      await writeFile(projxPath, JSON.stringify(projx, null, 2) + "\n");

      const userReadme = "# My Custom Readme — DO NOT TOUCH\n";
      await writeFile(join(dest, "README.md"), userReadme);

      await add(dest, ["fastify"], REPO_DIR, true, "email-ingestor");

      expect(await readFile(join(dest, "README.md"), "utf-8")).toBe(userReadme);
    });

    it("sets the new instance's package.json name from the custom dir name", async () => {
      dest = join(tmpdir(), `projx-add-name-pkgname-${Date.now()}`);
      await scaffold(
        { name: "my-app", components: ["fastify"], git: true, install: false },
        dest,
        REPO_DIR,
      );

      await add(dest, ["fastify"], REPO_DIR, true, "email-ingestor");

      const pkg = JSON.parse(
        await readFile(join(dest, "email-ingestor/package.json"), "utf-8"),
      );
      expect(pkg.name).toBe("my-app-email-ingestor");

      const fastifyPkg = JSON.parse(
        await readFile(join(dest, "fastify/package.json"), "utf-8"),
      );
      expect(fastifyPkg.name).toBe("my-app-fastify");
    });

    it("rejects when the target directory already exists", async () => {
      dest = join(tmpdir(), `projx-add-name-conflict-${Date.now()}`);
      await scaffold(
        { name: "my-app", components: ["fastify"], git: true, install: false },
        dest,
        REPO_DIR,
      );

      await expect(
        add(dest, ["fastify"], REPO_DIR, true, "fastify"),
      ).rejects.toThrow(/already exists/i);
    });
  });
});

describe("add — installDeps paths (mocked)", () => {
  let dest: string;
  let execSpy: ReturnType<typeof vi.spyOn>;
  let hasCommandSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execSpy = vi.spyOn(utilsModule, "exec").mockImplementation(() => "");
    hasCommandSpy = vi.spyOn(utilsModule, "hasCommand");
  });

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("runs install commands for the new instance when package manager is on PATH", async () => {
    dest = join(tmpdir(), `projx-add-install-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: "ai", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ["frontend"], REPO_DIR, false);

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes("npm install"))).toBe(true);
  });

  it("falls back to warn message when package manager is missing during add", async () => {
    dest = join(tmpdir(), `projx-add-no-pm-${Date.now()}`);
    hasCommandSpy.mockReturnValue(false);

    await scaffold(
      { name: "no-pm", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ["fastapi"], REPO_DIR, false);

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes("uv sync"))).toBe(false);
    expect(existsSync(join(dest, "fastapi"))).toBe(true);
  });

  it("skips installs when skipInstall=true", async () => {
    dest = join(tmpdir(), `projx-add-skip-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: "skip-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ["e2e"], REPO_DIR, true);

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(
      calls.every((c) => !c.includes("npm install") || !c.includes("e2e")),
    ).toBe(true);
  });

  it("copies .env.example to .env for the new instance", async () => {
    dest = join(tmpdir(), `projx-add-env-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: "env", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );
    await add(dest, ["frontend"], REPO_DIR, true);

    expect(existsSync(join(dest, "frontend/.env.example"))).toBe(true);
    expect(existsSync(join(dest, "frontend/.env"))).toBe(true);
  });
});
