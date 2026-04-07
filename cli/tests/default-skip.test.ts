import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { scaffold } from "../src/scaffold.js";
import { add } from "../src/add.js";
import { update, findPinnedFilesWithUpdates } from "../src/update.js";
import { unpin } from "../src/pin.js";
import {
  detectProjectName,
  discoverComponentsFromMarkers,
  pmCommands,
  readComponentMarker,
  readProjxConfig,
} from "../src/utils.js";
import type { GeneratorVars } from "../src/baseline.js";

const REPO_DIR = join(import.meta.dirname, "../..");

describe("default-skip — scenario A: fresh scaffold", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("fresh scaffold writes default skip patterns to .projx + markers", async () => {
    dest = join(tmpdir(), `projx-A1-${Date.now()}`);
    await scaffold(
      { name: "fresh-app", components: ["fastapi", "fastify", "frontend"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const config = await readProjxConfig(dest);
    expect(config.defaultsApplied).toBe(true);
    expect(config.skip).toContain("docker-compose.yml");
    expect(config.skip).toContain("docker-compose.dev.yml");
    expect(config.skip).toContain("README.md");
    expect(config.skip).toContain(".githooks/pre-commit");
    expect(config.skip).toContain(".github/workflows/ci.yml");
    expect(config.skip).toContain("setup.sh");

    const fastapiMarker = await readComponentMarker(join(dest, "fastapi"));
    expect(fastapiMarker?.skip).toContain("pyproject.toml");

    const fastifyMarker = await readComponentMarker(join(dest, "fastify"));
    expect(fastifyMarker?.skip).toContain("package.json");

    const frontendMarker = await readComponentMarker(join(dest, "frontend"));
    expect(frontendMarker?.skip).toContain("package.json");
  });

  it("fresh scaffold + customize ci.yml + update preserves customizations", async () => {
    dest = join(tmpdir(), `projx-A6-${Date.now()}`);
    await scaffold(
      { name: "fresh-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const ciPath = join(dest, ".github/workflows/ci.yml");
    let ci = await readFile(ciPath, "utf-8");
    ci = ci.replace("name: Fastify", "name: My Custom Backend Job");
    await writeFile(ciPath, ci);
    execSync("git add -A && git -c core.hooksPath=/dev/null commit -m 'customize ci'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const after = await readFile(ciPath, "utf-8");
    expect(after).toContain("name: My Custom Backend Job");
  });

  it("fresh scaffold + customize pre-commit + update preserves customizations", async () => {
    dest = join(tmpdir(), `projx-A7-${Date.now()}`);
    await scaffold(
      { name: "fresh-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const hookPath = join(dest, ".githooks/pre-commit");
    let hook = await readFile(hookPath, "utf-8");
    hook = hook.replace('echo "Formatting fastify..."', 'echo "Custom backend message"');
    await writeFile(hookPath, hook);
    execSync("git add -A && git -c core.hooksPath=/dev/null commit -m 'customize hook'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const after = await readFile(hookPath, "utf-8");
    expect(after).toContain("Custom backend message");
  });

  it("fresh scaffold + customize setup.sh + update preserves customizations", async () => {
    dest = join(tmpdir(), `projx-A8-${Date.now()}`);
    await scaffold(
      { name: "fresh-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const setupPath = join(dest, "setup.sh");
    let setup = await readFile(setupPath, "utf-8");
    setup = setup.replace("Fastify dependencies installed.", "Backend (custom) installed.");
    await writeFile(setupPath, setup);
    execSync("git add -A && git -c core.hooksPath=/dev/null commit -m 'customize setup'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const after = await readFile(setupPath, "utf-8");
    expect(after).toContain("Backend (custom) installed.");
  });

  it("fresh scaffold writes the actual files (not just skip records)", async () => {
    dest = join(tmpdir(), `projx-A2-${Date.now()}`);
    await scaffold(
      { name: "fresh-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const { existsSync } = await import("node:fs");
    expect(existsSync(join(dest, "docker-compose.yml"))).toBe(true);
    expect(existsSync(join(dest, "docker-compose.dev.yml"))).toBe(true);
    expect(existsSync(join(dest, "README.md"))).toBe(true);
    expect(existsSync(join(dest, "fastify/package.json"))).toBe(true);
  });

  it("fresh scaffold + immediate update is no-op (no new commits, clean tree)", async () => {
    dest = join(tmpdir(), `projx-A3-${Date.now()}`);
    await scaffold(
      { name: "fresh-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const before = parseInt(execSync("git rev-list --count HEAD", { cwd: dest, stdio: "pipe" }).toString().trim());
    await update(dest, REPO_DIR);
    const after = parseInt(execSync("git rev-list --count HEAD", { cwd: dest, stdio: "pipe" }).toString().trim());

    expect(after).toBe(before);
    expect(execSync("git status --porcelain", { cwd: dest, stdio: "pipe" }).toString().trim()).toBe("");
  });

  it("fresh scaffold + customize docker-compose + update preserves customizations", async () => {
    dest = join(tmpdir(), `projx-A4-${Date.now()}`);
    await scaffold(
      { name: "fresh-app", components: ["fastify", "frontend"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const composePath = join(dest, "docker-compose.dev.yml");
    let compose = await readFile(composePath, "utf-8");
    compose = compose.replace("'5173:5173'", "'3000:3000'");
    compose = compose.replace("app-network", "myapp-network");
    await writeFile(composePath, compose);
    execSync("git add -A && git -c core.hooksPath=/dev/null commit -m 'customize compose'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const after = await readFile(composePath, "utf-8");
    expect(after).toContain("'3000:3000'");
    expect(after).toContain("myapp-network");
  });

  it("fresh scaffold + customize package.json deps + update preserves them", async () => {
    dest = join(tmpdir(), `projx-A5-${Date.now()}`);
    await scaffold(
      { name: "fresh-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const pkgPath = join(dest, "fastify/package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    pkg.dependencies.nodemailer = "^8.0.0";
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
    execSync("git add -A && git -c core.hooksPath=/dev/null commit -m 'add nodemailer'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const after = JSON.parse(await readFile(pkgPath, "utf-8"));
    expect(after.dependencies.nodemailer).toBe("^8.0.0");
  });
});

describe("default-skip — scenario C: add new component", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("add applies the new component's default skip to its marker", async () => {
    dest = join(tmpdir(), `projx-C1-${Date.now()}`);
    await scaffold(
      { name: "add-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(dest, ["frontend"], REPO_DIR, true);

    const frontendMarker = await readComponentMarker(join(dest, "frontend"));
    expect(frontendMarker?.skip).toContain("package.json");
  });

  it("add does not touch root .projx skip patterns", async () => {
    dest = join(tmpdir(), `projx-C2-${Date.now()}`);
    await scaffold(
      { name: "add-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const before = await readProjxConfig(dest);
    const beforeSkip = JSON.stringify(before.skip);

    await add(dest, ["frontend"], REPO_DIR, true);

    const after = await readProjxConfig(dest);
    expect(JSON.stringify(after.skip)).toBe(beforeSkip);
  });
});

describe("default-skip — scenario D: pinned vs unpinned behavior", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("pinned package.json with template change is left alone (no merge attempted)", async () => {
    dest = join(tmpdir(), `projx-D1-${Date.now()}`);
    await scaffold(
      { name: "pin-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const pkgPath = join(dest, "fastify/package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    pkg.dependencies["custom-dep"] = "^1.0.0";
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
    execSync("git add -A && git -c core.hooksPath=/dev/null commit -m 'custom dep'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const after = JSON.parse(await readFile(pkgPath, "utf-8"));
    expect(after.dependencies["custom-dep"]).toBe("^1.0.0");
    const status = execSync("git status --porcelain fastify/package.json", { cwd: dest, stdio: "pipe" }).toString();
    expect(status.trim()).toBe("");
  });

  it("unpinned file flows updates normally", async () => {
    dest = join(tmpdir(), `projx-D2-${Date.now()}`);
    await scaffold(
      { name: "unpin-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await unpin(dest, ["docker-compose.yml"]);

    const config = await readProjxConfig(dest);
    expect(config.skip).not.toContain("docker-compose.yml");
  });
});

describe("default-skip — scenario E: legacy migration", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("legacy project (no defaultsApplied) gets defaults on first update", async () => {
    dest = join(tmpdir(), `projx-E1-${Date.now()}`);
    await scaffold(
      { name: "legacy-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await writeFile(join(dest, ".projx"), JSON.stringify({
      version: "1.4.0",
      components: ["fastify"],
      createdAt: "2026-01-01",
      packageManager: "npm",
    }, null, 2) + "\n");
    execSync("git add -A && git -c core.hooksPath=/dev/null commit -m 'legacy projx'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const config = await readProjxConfig(dest);
    expect(config.defaultsApplied).toBe(true);
    expect(config.skip).toContain("docker-compose.yml");
    expect(config.skip).toContain("README.md");

    const fastifyMarker = await readComponentMarker(join(dest, "fastify"));
    expect(fastifyMarker?.skip).toContain("package.json");
  });

  it("legacy migration unions defaults with user's existing skip patterns", async () => {
    dest = join(tmpdir(), `projx-E2-${Date.now()}`);
    await scaffold(
      { name: "legacy-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await writeFile(join(dest, ".projx"), JSON.stringify({
      version: "1.4.0",
      components: ["fastify"],
      createdAt: "2026-01-01",
      skip: ["custom-user-file.txt"],
    }, null, 2) + "\n");
    execSync("git add -A && git -c core.hooksPath=/dev/null commit -m 'legacy with user skip'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const config = await readProjxConfig(dest);
    expect(config.skip).toContain("custom-user-file.txt");
    expect(config.skip).toContain("docker-compose.yml");
    expect(config.skip).toContain("README.md");
  });

  it("after migration, defaults are NOT re-added if user unpins them", async () => {
    dest = join(tmpdir(), `projx-E3-${Date.now()}`);
    await scaffold(
      { name: "legacy-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await unpin(dest, ["README.md"]);
    execSync("git add -A && git -c core.hooksPath=/dev/null commit -m 'unpin readme'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const config = await readProjxConfig(dest);
    expect(config.skip).not.toContain("README.md");
    expect(config.defaultsApplied).toBe(true);
  });
});

describe("default-skip — scenario F: renamed component dirs", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("renamed component dir (fastify→backend) still gets default skip on legacy migration", async () => {
    dest = join(tmpdir(), `projx-F1-${Date.now()}`);
    await scaffold(
      { name: "rename-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSync(`mv "${join(dest, "fastify")}" "${join(dest, "backend")}"`, { stdio: "pipe" });

    await writeFile(join(dest, ".projx"), JSON.stringify({
      version: "1.4.0",
      components: ["fastify"],
      createdAt: "2026-01-01",
    }, null, 2) + "\n");

    await writeFile(join(dest, "backend/.projx-component"), JSON.stringify({
      components: ["fastify"],
    }, null, 2));

    execSync("git add -A && git -c core.hooksPath=/dev/null commit -m 'rename + legacy'", { cwd: dest, stdio: "pipe" });

    await update(dest, REPO_DIR);

    const marker = await readComponentMarker(join(dest, "backend"));
    expect(marker?.component).toBe("fastify");
    expect(marker?.skip).toContain("package.json");
  });
});

describe("default-skip — scenario G: pinned-update notification", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("findPinnedFilesWithUpdates reports nothing when pinned files match template", async () => {
    dest = join(tmpdir(), `projx-G1-${Date.now()}`);
    await scaffold(
      { name: "notify-app", components: ["fastify", "frontend"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const config = await readProjxConfig(dest);
    const { components, paths } = await discoverComponentsFromMarkers(dest);
    const name = detectProjectName(dest, components, paths);
    const vars: GeneratorVars = {
      projectName: name,
      components,
      paths,
      pm: pmCommands((config.packageManager as "npm") ?? "npm"),
    };

    const updates = await findPinnedFilesWithUpdates(
      dest,
      REPO_DIR,
      components,
      paths,
      vars,
      "1.5.6",
      undefined,
      Array.isArray(config.skip) ? (config.skip as string[]) : [],
    );

    expect(updates).toEqual([]);
  });

  it("findPinnedFilesWithUpdates reports a pinned file that diverges from template", async () => {
    dest = join(tmpdir(), `projx-G2-${Date.now()}`);
    await scaffold(
      { name: "notify-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const composePath = join(dest, "docker-compose.dev.yml");
    let compose = await readFile(composePath, "utf-8");
    compose = compose.replace("app-network", "user-renamed-network");
    await writeFile(composePath, compose);

    const config = await readProjxConfig(dest);
    const { components, paths } = await discoverComponentsFromMarkers(dest);
    const name = detectProjectName(dest, components, paths);
    const vars: GeneratorVars = {
      projectName: name,
      components,
      paths,
      pm: pmCommands((config.packageManager as "npm") ?? "npm"),
    };

    const updates = await findPinnedFilesWithUpdates(
      dest,
      REPO_DIR,
      components,
      paths,
      vars,
      "1.5.6",
      undefined,
      Array.isArray(config.skip) ? (config.skip as string[]) : [],
    );

    expect(updates).toContain("docker-compose.dev.yml");
  });
});
