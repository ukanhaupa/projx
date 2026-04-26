import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { scaffold } from "../src/scaffold.js";
import { add } from "../src/add.js";
import { update, learnSkips } from "../src/update.js";
import type { ComponentPaths } from "../src/utils.js";
import { existsSync } from "node:fs";

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

    await writeFile(
      join(dest, "fastify/src/custom-controller.ts"),
      "// my controller\n",
    );
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'add custom'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    const content = await readFile(
      join(dest, "fastify/src/custom-controller.ts"),
      "utf-8",
    );
    expect(content).toContain("my controller");
  });

  it("scaffold + immediate update is a no-op (no new commits)", async () => {
    dest = join(tmpdir(), `projx-update-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const commitsBefore = parseInt(
      execSync("git rev-list --count HEAD", { cwd: dest, stdio: "pipe" })
        .toString()
        .trim(),
    );

    await update(dest, REPO_DIR);

    const commitsAfter = parseInt(
      execSync("git rev-list --count HEAD", { cwd: dest, stdio: "pipe" })
        .toString()
        .trim(),
    );
    expect(commitsAfter).toBe(commitsBefore);
    expect(
      execSync("git status --porcelain", { cwd: dest, stdio: "pipe" })
        .toString()
        .trim(),
    ).toBe("");
  });

  it("produces single merge commit", async () => {
    dest = join(tmpdir(), `projx-update-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const commitsBefore = parseInt(
      execSync("git rev-list --count HEAD", { cwd: dest, stdio: "pipe" })
        .toString()
        .trim(),
    );

    await update(dest, REPO_DIR);

    const commitsAfter = parseInt(
      execSync("git rev-list --count HEAD", { cwd: dest, stdio: "pipe" })
        .toString()
        .trim(),
    );

    expect(commitsAfter - commitsBefore).toBeLessThanOrEqual(2);
  });

  it("learnSkips adds component files to component marker skip list", async () => {
    dest = join(tmpdir(), `projx-learn-${Date.now()}`);
    await scaffold(
      {
        name: "my-app",
        components: ["fastify", "frontend"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const paths: ComponentPaths = {
      fastapi: "fastapi",
      fastify: "fastify",
      frontend: "frontend",
      mobile: "mobile",
      e2e: "e2e",
      infra: "infra",
    };

    await learnSkips(
      dest,
      [
        "fastify/src/server.ts",
        "fastify/src/plugins/auth.ts",
        "frontend/src/App.tsx",
      ],
      paths,
    );

    const fastifyMarker = JSON.parse(
      await readFile(join(dest, "fastify/.projx-component"), "utf-8"),
    );
    expect(fastifyMarker.skip).toContain("src/server.ts");
    expect(fastifyMarker.skip).toContain("src/plugins/auth.ts");

    const frontendMarker = JSON.parse(
      await readFile(join(dest, "frontend/.projx-component"), "utf-8"),
    );
    expect(frontendMarker.skip).toContain("src/App.tsx");
  });

  it("learnSkips adds root files to .projx skip list", async () => {
    dest = join(tmpdir(), `projx-learn-root-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const paths: ComponentPaths = {
      fastapi: "fastapi",
      fastify: "fastify",
      frontend: "frontend",
      mobile: "mobile",
      e2e: "e2e",
      infra: "infra",
    };

    await learnSkips(dest, ["docker-compose.yml", "README.md"], paths);

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.skip).toContain("docker-compose.yml");
    expect(config.skip).toContain("README.md");
  });

  it("learnSkips preserves existing skip entries", async () => {
    dest = join(tmpdir(), `projx-learn-preserve-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const markerPath = join(dest, "fastify/.projx-component");
    const marker = JSON.parse(await readFile(markerPath, "utf-8"));
    marker.skip = ["src/existing.ts"];
    await writeFile(markerPath, JSON.stringify(marker, null, 2) + "\n");

    const paths: ComponentPaths = {
      fastapi: "fastapi",
      fastify: "fastify",
      frontend: "frontend",
      mobile: "mobile",
      e2e: "e2e",
      infra: "infra",
    };

    await learnSkips(dest, ["fastify/src/new-file.ts"], paths);

    const updated = JSON.parse(await readFile(markerPath, "utf-8"));
    expect(updated.skip).toContain("src/existing.ts");
    expect(updated.skip).toContain("src/new-file.ts");
  });

  it("preserves secondary instances of the same component type through update", async () => {
    dest = join(tmpdir(), `projx-update-multi-${Date.now()}`);
    await scaffold(
      { name: "my-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(dest, ["fastify"], REPO_DIR, true, "email-ingestor");

    await update(dest, REPO_DIR);

    expect(existsSync(join(dest, "fastify/.projx-component"))).toBe(true);
    expect(existsSync(join(dest, "email-ingestor/.projx-component"))).toBe(
      true,
    );
    expect(existsSync(join(dest, "email-ingestor/package.json"))).toBe(true);
    expect(existsSync(join(dest, "fastify/package.json"))).toBe(true);

    const marker = JSON.parse(
      await readFile(join(dest, "email-ingestor/.projx-component"), "utf-8"),
    );
    expect(marker.component).toBe("fastify");
  });
});

describe("update — schema migration on legacy projects", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("migrates .projx with legacy components array", async () => {
    dest = join(tmpdir(), `projx-mig-projx-${Date.now()}`);
    await scaffold(
      {
        name: "legacy-app",
        components: ["fastify"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await writeFile(
      join(dest, ".projx"),
      JSON.stringify(
        {
          version: "1.4.0",
          components: ["fastify"],
          createdAt: "2026-01-01",
          packageManager: "npm",
        },
        null,
        2,
      ) + "\n",
    );
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'legacy projx'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    const next = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(next.components).toBeUndefined();
    expect(next.createdAt).toBe("2026-01-01");
    expect(next.defaultsApplied).toBe(true);
    expect(next.skip).toContain("docker-compose.yml");
    expect(next.skip).toContain("docker-compose.dev.yml");
    expect(next.skip).toContain("README.md");
    expect(next.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("migrates .projx-component with legacy plural and origin", async () => {
    dest = join(tmpdir(), `projx-mig-marker-${Date.now()}`);
    await scaffold(
      {
        name: "legacy-app",
        components: ["fastify"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await writeFile(
      join(dest, "fastify/.projx-component"),
      JSON.stringify(
        {
          components: ["fastify"],
          origin: "scaffold",
          skip: ["src/custom.ts"],
        },
        null,
        2,
      ) + "\n",
    );
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'legacy marker'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    const marker = JSON.parse(
      await readFile(join(dest, "fastify/.projx-component"), "utf-8"),
    );
    expect(marker.component).toBe("fastify");
    expect(marker.skip).toEqual(["src/custom.ts"]);
    expect(marker.components).toBeUndefined();
    expect(marker.origin).toBeUndefined();
  });

  it("update with renamed component dir + legacy schema", async () => {
    dest = join(tmpdir(), `projx-rename-legacy-${Date.now()}`);
    await scaffold(
      {
        name: "legacy-app",
        components: ["fastify"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    execSync(`mv "${join(dest, "fastify")}" "${join(dest, "backend")}"`, {
      stdio: "pipe",
    });
    await writeFile(
      join(dest, "backend/.projx-component"),
      JSON.stringify(
        {
          components: ["fastify"],
          origin: "scaffold",
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(dest, ".projx"),
      JSON.stringify(
        {
          version: "1.4.0",
          components: ["fastify"],
          createdAt: "2026-01-01",
        },
        null,
        2,
      ) + "\n",
    );
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'rename + legacy'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    const marker = JSON.parse(
      await readFile(join(dest, "backend/.projx-component"), "utf-8"),
    );
    expect(marker.component).toBe("fastify");
    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.components).toBeUndefined();
  });
});

describe("update — pre-commit / ci.yml rename rendering", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("generates AI_PY/BACKEND_TS bash vars when dirs are renamed (after unpinning pre-commit)", async () => {
    dest = join(tmpdir(), `projx-pathsupper-${Date.now()}`);
    await scaffold(
      {
        name: "rename-app",
        components: ["fastapi", "fastify"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const { unpin } = await import("../src/pin.js");
    await unpin(dest, [".githooks/pre-commit"]);

    execSync(`mv "${join(dest, "fastapi")}" "${join(dest, "ai")}"`, {
      stdio: "pipe",
    });
    execSync(`mv "${join(dest, "fastify")}" "${join(dest, "backend")}"`, {
      stdio: "pipe",
    });
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'rename'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    const preCommit = await readFile(
      join(dest, ".githooks/pre-commit"),
      "utf-8",
    );
    expect(preCommit).toContain("AI_PY=");
    expect(preCommit).toContain("BACKEND_TS=");
    expect(preCommit).toContain("BACKEND_ALL=");
    expect(preCommit).not.toContain("FASTAPI_PY=");
    expect(preCommit).not.toContain("FASTIFY_TS=");
  });

  it("ci.yml uses path-derived job keys when renamed (after unpinning ci.yml)", async () => {
    dest = join(tmpdir(), `projx-ci-rename-${Date.now()}`);
    await scaffold(
      {
        name: "rename-app",
        components: ["fastapi", "fastify"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const { unpin } = await import("../src/pin.js");
    await unpin(dest, [".github/workflows/ci.yml"]);

    execSync(`mv "${join(dest, "fastapi")}" "${join(dest, "ai")}"`, {
      stdio: "pipe",
    });
    execSync(`mv "${join(dest, "fastify")}" "${join(dest, "backend")}"`, {
      stdio: "pipe",
    });
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'rename'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    const ci = await readFile(join(dest, ".github/workflows/ci.yml"), "utf-8");
    expect(ci).toContain("ai:");
    expect(ci).toContain("backend:");
    expect(ci).toContain("needs.changes.outputs.ai");
    expect(ci).toContain("needs.changes.outputs.backend");
  });
});

describe("findFilesWithConflictMarkers", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("finds files with conflict markers", async () => {
    dest = join(tmpdir(), `projx-conflicts-${Date.now()}`);
    await mkdir(dest, { recursive: true });
    execSync("git init -q", { cwd: dest, stdio: "pipe" });
    execSync("git config user.email test@test.com", {
      cwd: dest,
      stdio: "pipe",
    });
    execSync("git config user.name Test", { cwd: dest, stdio: "pipe" });
    await writeFile(join(dest, "clean.txt"), "ok\n");
    await writeFile(
      join(dest, "conflicted.txt"),
      "<<<<<<< your changes\nfoo\n=======\nbar\n>>>>>>> new projx template\n",
    );
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -qm 'init'",
      { cwd: dest, stdio: "pipe" },
    );

    const { findFilesWithConflictMarkers } = await import("../src/update.js");
    const found = findFilesWithConflictMarkers(dest);
    expect(found).toContain("conflicted.txt");
    expect(found).not.toContain("clean.txt");
  });

  it("returns empty array when no conflicts", async () => {
    dest = join(tmpdir(), `projx-no-conflicts-${Date.now()}`);
    await mkdir(dest, { recursive: true });
    execSync("git init -q", { cwd: dest, stdio: "pipe" });
    execSync("git config user.email test@test.com", {
      cwd: dest,
      stdio: "pipe",
    });
    execSync("git config user.name Test", { cwd: dest, stdio: "pipe" });
    await writeFile(join(dest, "clean.txt"), "ok\n");
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -qm 'init'",
      { cwd: dest, stdio: "pipe" },
    );

    const { findFilesWithConflictMarkers } = await import("../src/update.js");
    const found = findFilesWithConflictMarkers(dest);
    expect(found).toEqual([]);
  });

  it("returns empty array in non-git directory", async () => {
    dest = join(tmpdir(), `projx-non-git-${Date.now()}`);
    await mkdir(dest, { recursive: true });
    await writeFile(
      join(dest, "conflicted.txt"),
      "<<<<<<< your changes\nfoo\n=======\nbar\n>>>>>>> new projx template\n",
    );

    const { findFilesWithConflictMarkers } = await import("../src/update.js");
    const found = findFilesWithConflictMarkers(dest);
    expect(found).toEqual([]);
  });
});

describe("update — packageManager auto-sync", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("syncs .projx.packageManager from lockfile when mismatched", async () => {
    dest = join(tmpdir(), `projx-pm-sync-${Date.now()}`);
    await scaffold(
      {
        name: "pm-app",
        components: ["fastify"],
        git: true,
        install: false,
        packageManager: "npm",
      },
      dest,
      REPO_DIR,
    );

    await rm(join(dest, "fastify/package-lock.json"), { force: true });
    await writeFile(join(dest, "fastify/pnpm-lock.yaml"), "");
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'switch to pnpm'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(config.packageManager).toBe("pnpm");
  });
});
