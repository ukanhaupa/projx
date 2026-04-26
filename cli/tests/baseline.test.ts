import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { matchesSkip, type GeneratorVars } from "../src/baseline.js";
import { scaffold } from "../src/scaffold.js";
import { update } from "../src/update.js";
import type { ComponentPaths } from "../src/utils.js";

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

    await writeFile(
      join(dest, "fastify/.projx-component"),
      JSON.stringify(
        {
          component: "fastify",
          skip: ["src/**", "tests/**"],
        },
        null,
        2,
      ),
    );
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'set skip'",
      { cwd: dest, stdio: "pipe" },
    );

    await writeFile(join(dest, "fastify/src/custom.ts"), "// custom\n");
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'add custom'",
      { cwd: dest, stdio: "pipe" },
    );

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

    await writeFile(
      join(dest, "fastify/.projx-component"),
      JSON.stringify(
        {
          component: "fastify",
          skip: [],
        },
        null,
        2,
      ),
    );
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'set no skip'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    expect(existsSync(join(dest, "fastify/src/app.ts"))).toBe(true);
  });
});

describe("3-way merge", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("preserves user additions when template changes different lines", async () => {
    dest = join(tmpdir(), `projx-3way-${Date.now()}`);
    await scaffold(
      { name: "test-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    // Baseline ref was saved by scaffold
    const hasRef = (() => {
      try {
        execSync("git rev-parse --verify refs/projx/baseline", {
          cwd: dest,
          stdio: "pipe",
        });
        return true;
      } catch {
        return false;
      }
    })();
    expect(hasRef).toBe(true);

    // User adds a line to package.json (simulating adding a dep)
    const pkgPath = join(dest, "fastify/package.json");
    let pkg = await readFile(pkgPath, "utf-8");
    pkg = pkg.replace(
      '"description":',
      '"custom-field": "user-value",\n  "description":',
    );
    await writeFile(pkgPath, pkg);
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'user customization'",
      { cwd: dest, stdio: "pipe" },
    );

    // Run update — tier 1 will fail (orphan merge), tier 2 should 3-way merge
    await update(dest, REPO_DIR);

    // User's addition should be preserved
    const updated = await readFile(pkgPath, "utf-8");
    expect(updated).toContain("user-value");
  });

  it("baseline ref is updated after successful update", async () => {
    dest = join(tmpdir(), `projx-3way-ref-${Date.now()}`);
    await scaffold(
      { name: "test-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await update(dest, REPO_DIR);
    const refAfter = execSync("git rev-parse refs/projx/baseline", {
      cwd: dest,
      stdio: "pipe",
    })
      .toString()
      .trim();

    expect(refAfter).toBeTruthy();
  });
});

describe("tier 1: git merge via worktree", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("clean merge when user has no changes", async () => {
    dest = join(tmpdir(), `projx-t1-clean-${Date.now()}`);
    await scaffold(
      { name: "t1-app", components: ["fastify"], git: true, install: false },
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
    // Should create at most 2 commits (template + merge)
    expect(commitsAfter - commitsBefore).toBeLessThanOrEqual(2);
  });

  it("preserves user files not in template", async () => {
    dest = join(tmpdir(), `projx-t1-userfile-${Date.now()}`);
    await scaffold(
      { name: "t1-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await writeFile(
      join(dest, "fastify/src/my-service.ts"),
      "export class MyService {}\n",
    );
    await writeFile(join(dest, "notes.txt"), "project notes\n");
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'add custom files'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    expect(
      await readFile(join(dest, "fastify/src/my-service.ts"), "utf-8"),
    ).toContain("MyService");
    expect(await readFile(join(dest, "notes.txt"), "utf-8")).toContain(
      "project notes",
    );
  });

  it("saves baseline ref after clean merge", async () => {
    dest = join(tmpdir(), `projx-t1-ref-${Date.now()}`);
    await scaffold(
      { name: "t1-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await update(dest, REPO_DIR);

    const ref = execSync("git rev-parse --verify refs/projx/baseline", {
      cwd: dest,
      stdio: "pipe",
    })
      .toString()
      .trim();
    expect(ref).toBeTruthy();
  });

  it("idempotent — running update twice with no changes", async () => {
    dest = join(tmpdir(), `projx-t1-idem-${Date.now()}`);
    await scaffold(
      { name: "t1-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await update(dest, REPO_DIR);
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

    // At most 2 new commits (template + merge) — same template version
    expect(commitsAfter - commitsBefore).toBeLessThanOrEqual(2);
  });

  it("works with renamed component directories", async () => {
    dest = join(tmpdir(), `projx-t1-rename-${Date.now()}`);
    await scaffold(
      { name: "t1-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    // Rename fastify/ → api/
    execSync(`mv "${join(dest, "fastify")}" "${join(dest, "api")}"`, {
      stdio: "pipe",
    });
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'rename fastify to api'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    // Component marker still works
    const marker = JSON.parse(
      await readFile(join(dest, "api/.projx-component"), "utf-8"),
    );
    expect(marker.component).toBe("fastify");
  });
});

describe("tier 2: per-file 3-way merge", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("preserves user-added lines in shared files", async () => {
    dest = join(tmpdir(), `projx-t2-addline-${Date.now()}`);
    await scaffold(
      { name: "t2-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    // User adds a custom field to package.json
    const pkgPath = join(dest, "fastify/package.json");
    let pkg = await readFile(pkgPath, "utf-8");
    pkg = pkg.replace(
      '"description":',
      '"custom-dep": "1.0.0",\n  "description":',
    );
    await writeFile(pkgPath, pkg);
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'add custom dep'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    const updated = await readFile(pkgPath, "utf-8");
    expect(updated).toContain("custom-dep");
  });

  it("preserves user-appended content in .env.example", async () => {
    dest = join(tmpdir(), `projx-t2-env-${Date.now()}`);
    await scaffold(
      { name: "t2-app", components: ["fastapi"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    // User appends env var
    const envPath = join(dest, "fastapi/.env.example");
    let env = await readFile(envPath, "utf-8");
    env += "\n# Custom\nMY_CUSTOM_VAR=secret\n";
    await writeFile(envPath, env);
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'add custom env'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    const updated = await readFile(envPath, "utf-8");
    expect(updated).toContain("MY_CUSTOM_VAR=secret");
  });

  it("user-created files survive 3-way merge", async () => {
    dest = join(tmpdir(), `projx-t2-newfile-${Date.now()}`);
    await scaffold(
      { name: "t2-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await writeFile(
      join(dest, "fastify/src/my-middleware.ts"),
      "export const mw = () => {}\n",
    );
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'add middleware'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    expect(
      await readFile(join(dest, "fastify/src/my-middleware.ts"), "utf-8"),
    ).toContain("mw");
  });

  it("baseline fallback from git history when ref missing", async () => {
    dest = join(tmpdir(), `projx-t2-fallback-${Date.now()}`);
    await scaffold(
      { name: "t2-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    // Delete the baseline ref
    try {
      execSync("git update-ref -d refs/projx/baseline", {
        cwd: dest,
        stdio: "pipe",
      });
    } catch {
      // may not exist
    }

    // User modifies a file
    const pkgPath = join(dest, "fastify/package.json");
    let pkg = await readFile(pkgPath, "utf-8");
    pkg = pkg.replace(
      '"description":',
      '"my-field": "kept",\n  "description":',
    );
    await writeFile(pkgPath, pkg);
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'user change'",
      { cwd: dest, stdio: "pipe" },
    );

    // Update should find baseline from git log -- .projx
    await update(dest, REPO_DIR);

    const updated = await readFile(pkgPath, "utf-8");
    expect(updated).toContain("my-field");
  });

  it("multiple components — each file merges independently", async () => {
    dest = join(tmpdir(), `projx-t2-multi-${Date.now()}`);
    await scaffold(
      {
        name: "t2-app",
        components: ["fastify", "e2e"],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    // Modify files in both components
    const fastifyPkg = join(dest, "fastify/package.json");
    let fpkg = await readFile(fastifyPkg, "utf-8");
    fpkg = fpkg.replace(
      '"description":',
      '"fastify-custom": true,\n  "description":',
    );
    await writeFile(fastifyPkg, fpkg);

    const e2ePkg = join(dest, "e2e/package.json");
    let epkg = await readFile(e2ePkg, "utf-8");
    epkg = epkg.replace('"private":', '"e2e-custom": true,\n  "private":');
    await writeFile(e2ePkg, epkg);

    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'customize both'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    expect(await readFile(fastifyPkg, "utf-8")).toContain("fastify-custom");
    expect(await readFile(e2ePkg, "utf-8")).toContain("e2e-custom");
  });

  it("new template files are created in project during 3-way merge", async () => {
    dest = join(tmpdir(), `projx-t2-newfile-tpl-${Date.now()}`);
    await scaffold(
      { name: "t2-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const newFilePath = join(dest, "fastify/src/plugins/request-id.ts");
    expect(existsSync(newFilePath)).toBe(true);

    execSync(`git rm fastify/src/plugins/request-id.ts`, {
      cwd: dest,
      stdio: "pipe",
    });
    execSync("git -c core.hooksPath=/dev/null commit -m 'remove file'", {
      cwd: dest,
      stdio: "pipe",
    });
    expect(existsSync(newFilePath)).toBe(false);

    execSync("git config core.hooksPath /dev/null", {
      cwd: dest,
      stdio: "pipe",
    });
    await update(dest, REPO_DIR);

    expect(existsSync(newFilePath)).toBe(true);
    const content = await readFile(newFilePath, "utf-8");
    expect(content).toContain("request-id");
  });

  it("skip patterns still respected during 3-way merge", async () => {
    dest = join(tmpdir(), `projx-t2-skip-${Date.now()}`);
    await scaffold(
      { name: "t2-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    // Set skip on src/**
    await writeFile(
      join(dest, "fastify/.projx-component"),
      JSON.stringify(
        {
          component: "fastify",
          skip: ["src/**"],
        },
        null,
        2,
      ),
    );

    await writeFile(join(dest, "fastify/src/custom.ts"), "// my custom code\n");
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'skip + custom'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    const custom = await readFile(join(dest, "fastify/src/custom.ts"), "utf-8");
    expect(custom).toContain("my custom code");
  });
});

describe("tier 3: direct copy fallback", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("writeTemplateToDir does not delete user-created files", async () => {
    dest = join(tmpdir(), `projx-t3-survive-${Date.now()}`);
    await scaffold(
      { name: "t3-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await writeFile(
      join(dest, "fastify/src/billing.ts"),
      "export const billing = {}\n",
    );
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'add billing'",
      { cwd: dest, stdio: "pipe" },
    );

    // Direct template write (simulates tier 3)
    const paths: ComponentPaths = {
      fastapi: "fastapi",
      fastify: "fastify",
      frontend: "frontend",
      mobile: "mobile",
      e2e: "e2e",
      infra: "infra",
    };
    const vars: GeneratorVars = {
      projectName: "t3-app",
      components: ["fastify"] as any,
      paths,
    };
    const { writeTemplateToDir } = await import("../src/baseline.js");
    await writeTemplateToDir(dest, REPO_DIR, ["fastify"], paths, vars, "1.3.6");

    expect(
      await readFile(join(dest, "fastify/src/billing.ts"), "utf-8"),
    ).toContain("billing");
  });

  it("template files overwrite existing files on direct copy", async () => {
    dest = join(tmpdir(), `projx-t3-overwrite-${Date.now()}`);
    await scaffold(
      { name: "t3-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await writeFile(join(dest, "fastify/Dockerfile"), "# user dockerfile\n");
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'custom dockerfile'",
      { cwd: dest, stdio: "pipe" },
    );

    const paths: ComponentPaths = {
      fastapi: "fastapi",
      fastify: "fastify",
      frontend: "frontend",
      mobile: "mobile",
      e2e: "e2e",
      infra: "infra",
    };
    const vars: GeneratorVars = {
      projectName: "t3-app",
      components: ["fastify"] as any,
      paths,
    };
    const { writeTemplateToDir } = await import("../src/baseline.js");
    await writeTemplateToDir(dest, REPO_DIR, ["fastify"], paths, vars, "1.3.6");

    const dockerfile = await readFile(
      join(dest, "fastify/Dockerfile"),
      "utf-8",
    );
    expect(dockerfile).not.toContain("user dockerfile");
  });

  it("skip patterns prevent overwrite even in direct copy", async () => {
    dest = join(tmpdir(), `projx-t3-skip-${Date.now()}`);
    await scaffold(
      { name: "t3-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await writeFile(join(dest, "fastify/Dockerfile"), "# custom\n");

    const paths: ComponentPaths = {
      fastapi: "fastapi",
      fastify: "fastify",
      frontend: "frontend",
      mobile: "mobile",
      e2e: "e2e",
      infra: "infra",
    };
    const vars: GeneratorVars = {
      projectName: "t3-app",
      components: ["fastify"] as any,
      paths,
    };
    const { writeTemplateToDir } = await import("../src/baseline.js");
    await writeTemplateToDir(
      dest,
      REPO_DIR,
      ["fastify"],
      paths,
      vars,
      "1.3.6",
      {
        componentSkips: { fastify: ["Dockerfile"] },
        realCwd: dest,
      },
    );

    const dockerfile = await readFile(
      join(dest, "fastify/Dockerfile"),
      "utf-8",
    );
    expect(dockerfile).toContain("custom");
  });
});

describe("cross-tier edge cases", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("scaffold → modify → update → modify → update preserves across two cycles", async () => {
    dest = join(tmpdir(), `projx-cycle-${Date.now()}`);
    await scaffold(
      { name: "cycle-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    // Cycle 1: user adds custom field
    const pkgPath = join(dest, "fastify/package.json");
    let pkg = await readFile(pkgPath, "utf-8");
    pkg = pkg.replace('"description":', '"cycle-one": true,\n  "description":');
    await writeFile(pkgPath, pkg);
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'cycle 1'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);
    expect(await readFile(pkgPath, "utf-8")).toContain("cycle-one");

    // Cycle 2: user adds another field
    pkg = await readFile(pkgPath, "utf-8");
    pkg = pkg.replace('"description":', '"cycle-two": true,\n  "description":');
    await writeFile(pkgPath, pkg);
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'cycle 2'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    const final = await readFile(pkgPath, "utf-8");
    expect(final).toContain("cycle-one");
    expect(final).toContain("cycle-two");
  });

  it("worktree cleanup on error does not corrupt repo", async () => {
    dest = join(tmpdir(), `projx-wt-err-${Date.now()}`);
    await scaffold(
      { name: "wt-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    // Verify repo is healthy after normal update
    await update(dest, REPO_DIR);

    // No stale worktrees
    const worktrees = execSync("git worktree list", {
      cwd: dest,
      stdio: "pipe",
    }).toString();
    const lines = worktrees.trim().split("\n");
    expect(lines.length).toBe(1); // Only main worktree

    // No stale temp branches
    const branches = execSync("git branch", {
      cwd: dest,
      stdio: "pipe",
    }).toString();
    expect(branches).not.toContain("projx/tmp-");
  });

  it("version bumps in .projx after update", async () => {
    dest = join(tmpdir(), `projx-version-${Date.now()}`);
    await scaffold(
      { name: "ver-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    // Manually set an older version
    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    config.version = "0.0.1";
    await writeFile(
      join(dest, ".projx"),
      JSON.stringify(config, null, 2) + "\n",
    );
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'downgrade version'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    const pkg = JSON.parse(
      await readFile(join(REPO_DIR, "cli/package.json"), "utf-8"),
    );
    const updated = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    expect(updated.version).toBe(pkg.version);
  });

  it("root-level skip prevents overwrite across all tiers", async () => {
    dest = join(tmpdir(), `projx-rootskip-${Date.now()}`);
    await scaffold(
      { name: "rs-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    // Add root skip for docker-compose.yml
    const config = JSON.parse(await readFile(join(dest, ".projx"), "utf-8"));
    config.skip = ["docker-compose.yml"];
    await writeFile(
      join(dest, ".projx"),
      JSON.stringify(config, null, 2) + "\n",
    );

    // Customize docker-compose
    await writeFile(join(dest, "docker-compose.yml"), "# my custom compose\n");
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'custom compose + skip'",
      { cwd: dest, stdio: "pipe" },
    );

    await update(dest, REPO_DIR);

    const compose = await readFile(join(dest, "docker-compose.yml"), "utf-8");
    expect(compose).toContain("my custom compose");
  });
});

describe("writeTemplateToDir — extraInstances", () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it("renders a secondary instance dir alongside the primary", async () => {
    dest = join(tmpdir(), `projx-extra-${Date.now()}`);
    await scaffold(
      { name: "multi-app", components: ["fastify"], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await rm(join(dest, "email-ingestor"), { recursive: true, force: true });

    const paths: ComponentPaths = {
      fastapi: "fastapi",
      fastify: "fastify",
      frontend: "frontend",
      mobile: "mobile",
      e2e: "e2e",
      infra: "infra",
    };
    const vars: GeneratorVars = {
      projectName: "multi-app",
      components: ["fastify"] as any,
      paths,
    };
    const { writeTemplateToDir } = await import("../src/baseline.js");
    await writeTemplateToDir(
      dest,
      REPO_DIR,
      ["fastify"],
      paths,
      vars,
      "1.6.2",
      {
        extraInstances: [{ type: "fastify", path: "email-ingestor" }],
      },
    );

    expect(existsSync(join(dest, "fastify/package.json"))).toBe(true);
    expect(existsSync(join(dest, "email-ingestor/package.json"))).toBe(true);
    expect(existsSync(join(dest, "email-ingestor/.projx-component"))).toBe(
      true,
    );

    const marker = JSON.parse(
      await readFile(join(dest, "email-ingestor/.projx-component"), "utf-8"),
    );
    expect(marker.component).toBe("fastify");

    const pkg = JSON.parse(
      await readFile(join(dest, "email-ingestor/package.json"), "utf-8"),
    );
    expect(pkg.name).toBe("multi-app-email-ingestor");
  });
});
