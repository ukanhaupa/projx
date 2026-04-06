import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  toKebab,
  toSnake,
  toTitle,
  render,
  readFileOrNull,
  writeComponentMarker,
  discoverComponentPaths,
  replaceInFile,
  replaceInDir,
  detectPackageManager,
  pmCommands,
  COMPONENT_MARKER,
  type Component,
} from "../src/utils.js";

describe("toKebab", () => {
  it("converts camelCase", () => {
    expect(toKebab("myApp")).toBe("my-app");
  });

  it("converts PascalCase", () => {
    expect(toKebab("MyApp")).toBe("my-app");
  });

  it("converts spaces", () => {
    expect(toKebab("my app")).toBe("my-app");
  });

  it("converts underscores", () => {
    expect(toKebab("my_app")).toBe("my-app");
  });

  it("lowercases", () => {
    expect(toKebab("MY-APP")).toBe("my-app");
  });

  it("handles already kebab", () => {
    expect(toKebab("my-app")).toBe("my-app");
  });
});

describe("toSnake", () => {
  it("converts kebab to snake", () => {
    expect(toSnake("my-app")).toBe("my_app");
  });

  it("converts camelCase to snake", () => {
    expect(toSnake("myApp")).toBe("my_app");
  });

  it("converts spaces to snake", () => {
    expect(toSnake("my app")).toBe("my_app");
  });
});

describe("toTitle", () => {
  it("converts kebab to title", () => {
    expect(toTitle("my-app")).toBe("My App");
  });

  it("converts snake to title", () => {
    expect(toTitle("my_app")).toBe("My App");
  });

  it("converts spaces to title", () => {
    expect(toTitle("my app")).toBe("My App");
  });
});

describe("render", () => {
  it("replaces simple variables", () => {
    const tpl = "name: <%= projectName %>";
    const result = render(tpl, { projectName: "my-app", components: [] });
    expect(result).toBe("name: my-app");
  });

  it("replaces dotted variables", () => {
    const tpl = "cd <%= paths.fastapi %>";
    const result = render(tpl, {
      projectName: "app",
      components: ["fastapi"],
      paths: { fastapi: "backend" },
    });
    expect(result).toBe("cd backend");
  });

  it("handles if blocks — included", () => {
    const tpl = [
      "<% if (components.includes('fastapi')) { %>",
      "fastapi line",
      "<% } %>",
    ].join("\n");
    const result = render(tpl, { projectName: "app", components: ["fastapi"] });
    expect(result).toBe("fastapi line");
  });

  it("handles if blocks — excluded", () => {
    const tpl = [
      "<% if (components.includes('fastapi')) { %>",
      "fastapi line",
      "<% } %>",
    ].join("\n");
    const result = render(tpl, { projectName: "app", components: ["fastify"] });
    expect(result).toBe("");
  });

  it("handles if/else blocks", () => {
    const tpl = [
      "<% if (components.includes('fastapi')) { %>",
      "python",
      "<% } else { %>",
      "node",
      "<% } %>",
    ].join("\n");
    const result = render(tpl, { projectName: "app", components: ["fastify"] });
    expect(result).toBe("node");
  });

  it("collapses triple newlines", () => {
    const tpl = "a\n\n\n\nb";
    const result = render(tpl, { projectName: "app", components: [] });
    expect(result).toBe("a\n\nb");
  });

  it("returns empty string for missing dotted var", () => {
    const tpl = "<%= paths.missing %>";
    const result = render(tpl, { projectName: "app", components: [], paths: {} });
    expect(result).toBe("");
  });
});

describe("readFileOrNull", () => {
  it("returns content for existing file", async () => {
    const tmp = join(tmpdir(), `projx-test-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
    const f = join(tmp, "test.txt");
    await writeFile(f, "hello");
    expect(await readFileOrNull(f)).toBe("hello");
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns null for missing file", async () => {
    expect(await readFileOrNull("/nonexistent/file.txt")).toBeNull();
  });
});

describe("writeComponentMarker", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-test-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("writes marker file with component and origin", async () => {
    await writeComponentMarker(tmp, "fastapi");
    const content = JSON.parse(await readFile(join(tmp, COMPONENT_MARKER), "utf-8"));
    expect(content.components).toEqual(["fastapi"]);
    expect(content.origin).toBe("scaffold");
  });

  it("writes init origin", async () => {
    await writeComponentMarker(tmp, "fastapi", "init");
    const content = JSON.parse(await readFile(join(tmp, COMPONENT_MARKER), "utf-8"));
    expect(content.origin).toBe("init");
  });

  it("appends component to existing marker", async () => {
    await writeComponentMarker(tmp, "frontend");
    await writeComponentMarker(tmp, "e2e");
    const content = JSON.parse(await readFile(join(tmp, COMPONENT_MARKER), "utf-8"));
    expect(content.components).toEqual(["frontend", "e2e"]);
  });

  it("does not duplicate existing component", async () => {
    await writeComponentMarker(tmp, "fastapi");
    await writeComponentMarker(tmp, "fastapi");
    const content = JSON.parse(await readFile(join(tmp, COMPONENT_MARKER), "utf-8"));
    expect(content.components).toEqual(["fastapi"]);
  });
});

describe("discoverComponentPaths", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-test-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("discovers renamed component directories", async () => {
    await mkdir(join(tmp, "backend"));
    await writeComponentMarker(join(tmp, "backend"), "fastapi");
    await mkdir(join(tmp, "web"));
    await writeComponentMarker(join(tmp, "web"), "frontend");

    const paths = await discoverComponentPaths(tmp, ["fastapi", "frontend"] as Component[]);
    expect(paths.fastapi).toBe("backend");
    expect(paths.frontend).toBe("web");
  });

  it("falls back to component name when no marker found", async () => {
    const paths = await discoverComponentPaths(tmp, ["fastapi"] as Component[]);
    expect(paths.fastapi).toBe("fastapi");
  });

  it("ignores dotfiles and excluded directories", async () => {
    await mkdir(join(tmp, ".hidden"));
    await writeComponentMarker(join(tmp, ".hidden"), "fastapi");
    await mkdir(join(tmp, "node_modules"));
    await writeComponentMarker(join(tmp, "node_modules"), "fastify");

    const paths = await discoverComponentPaths(tmp, ["fastapi", "fastify"] as Component[]);
    expect(paths.fastapi).toBe("fastapi");
    expect(paths.fastify).toBe("fastify");
  });
});

describe("detectPackageManager", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-pm-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("detects pnpm from lockfile", async () => {
    await writeFile(join(tmp, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(tmp)).toBe("pnpm");
  });

  it("detects yarn from lockfile", async () => {
    await writeFile(join(tmp, "yarn.lock"), "");
    expect(detectPackageManager(tmp)).toBe("yarn");
  });

  it("detects bun from lockfile", async () => {
    await writeFile(join(tmp, "bun.lockb"), "");
    expect(detectPackageManager(tmp)).toBe("bun");
  });

  it("detects npm from lockfile", async () => {
    await writeFile(join(tmp, "package-lock.json"), "{}");
    expect(detectPackageManager(tmp)).toBe("npm");
  });

  it("returns null when no lockfile", () => {
    expect(detectPackageManager(tmp)).toBeNull();
  });

  it("prioritizes bun over pnpm", async () => {
    await writeFile(join(tmp, "bun.lockb"), "");
    await writeFile(join(tmp, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(tmp)).toBe("bun");
  });
});

describe("pmCommands", () => {
  it("returns correct npm commands", () => {
    const cmd = pmCommands("npm");
    expect(cmd.name).toBe("npm");
    expect(cmd.install).toBe("npm install");
    expect(cmd.ci).toBe("npm ci");
    expect(cmd.exec).toBe("npx");
    expect(cmd.lockfile).toBe("package-lock.json");
  });

  it("returns correct pnpm commands", () => {
    const cmd = pmCommands("pnpm");
    expect(cmd.name).toBe("pnpm");
    expect(cmd.ci).toBe("pnpm install --frozen-lockfile");
    expect(cmd.run).toBe("pnpm");
    expect(cmd.lockfile).toBe("pnpm-lock.yaml");
  });

  it("returns correct yarn commands", () => {
    const cmd = pmCommands("yarn");
    expect(cmd.install).toBe("yarn");
    expect(cmd.ci).toBe("yarn --frozen-lockfile");
    expect(cmd.lockfile).toBe("yarn.lock");
  });

  it("returns correct bun commands", () => {
    const cmd = pmCommands("bun");
    expect(cmd.install).toBe("bun install");
    expect(cmd.exec).toBe("bunx");
    expect(cmd.lockfile).toBe("bun.lockb");
  });
});

const ALL_PMS = ["npm", "pnpm", "yarn", "bun"] as const;

describe.each(ALL_PMS)("render with pm=%s", (pm) => {
  const cmd = pmCommands(pm);

  it("renders install command", () => {
    const tpl = "run: <%= pm.install %>";
    const result = render(tpl, { projectName: "app", components: [], pm: cmd });
    expect(result).toBe(`run: ${cmd.install}`);
  });

  it("renders ci command", () => {
    const tpl = "run: <%= pm.ci %>";
    const result = render(tpl, { projectName: "app", components: [], pm: cmd });
    expect(result).toBe(`run: ${cmd.ci}`);
  });

  it("renders exec command", () => {
    const tpl = "<%= pm.exec %> prisma";
    const result = render(tpl, { projectName: "app", components: [], pm: cmd });
    expect(result).toBe(`${cmd.exec} prisma`);
  });

  it("renders lockfile name", () => {
    const tpl = "cache: <%= pm.lockfile %>";
    const result = render(tpl, { projectName: "app", components: [], pm: cmd });
    expect(result).toBe(`cache: ${cmd.lockfile}`);
  });

  it("renders pm name", () => {
    const tpl = "cache: <%= pm.name %>";
    const result = render(tpl, { projectName: "app", components: [], pm: cmd });
    expect(result).toBe(`cache: ${pm}`);
  });

  it("matches own name in conditionals", () => {
    const tpl = [
      `<% if (pm === '${pm}') { %>`,
      "matched",
      "<% } %>",
    ].join("\n");
    const result = render(tpl, { projectName: "app", components: [], pm: cmd });
    expect(result).toBe("matched");
  });

  it("excludes other PM conditionals", () => {
    const other = ALL_PMS.find((p) => p !== pm)!;
    const tpl = [
      `<% if (pm === '${other}') { %>`,
      "should not appear",
      "<% } %>",
    ].join("\n");
    const result = render(tpl, { projectName: "app", components: [], pm: cmd });
    expect(result).toBe("");
  });
});

describe("replaceInFile", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-test-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("replaces text in file", async () => {
    const f = join(tmp, "test.txt");
    await writeFile(f, "hello projx-fastapi world");
    await replaceInFile(f, "projx-fastapi", "my-app-fastapi");
    expect(await readFile(f, "utf-8")).toBe("hello my-app-fastapi world");
  });

  it("does nothing for missing file", async () => {
    await replaceInFile(join(tmp, "nope.txt"), "a", "b");
  });

  it("does nothing when find string not present", async () => {
    const f = join(tmp, "test.txt");
    await writeFile(f, "hello world");
    await replaceInFile(f, "missing", "replaced");
    expect(await readFile(f, "utf-8")).toBe("hello world");
  });
});

describe("replaceInDir", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-test-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("replaces in matching files recursively", async () => {
    await mkdir(join(tmp, "sub"));
    await writeFile(join(tmp, "a.dart"), "import 'package:projx_mobile/x';");
    await writeFile(join(tmp, "sub/b.dart"), "import 'package:projx_mobile/y';");
    await writeFile(join(tmp, "c.ts"), "import 'package:projx_mobile/z';");

    await replaceInDir(tmp, "package:projx_mobile/", "package:my_app_mobile/", ".dart");

    expect(await readFile(join(tmp, "a.dart"), "utf-8")).toBe("import 'package:my_app_mobile/x';");
    expect(await readFile(join(tmp, "sub/b.dart"), "utf-8")).toBe("import 'package:my_app_mobile/y';");
    expect(await readFile(join(tmp, "c.ts"), "utf-8")).toBe("import 'package:projx_mobile/z';");
  });
});
