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

  it("writes marker file with component name", async () => {
    await writeComponentMarker(tmp, "fastapi");
    const content = JSON.parse(await readFile(join(tmp, COMPONENT_MARKER), "utf-8"));
    expect(content).toEqual({ component: "fastapi" });
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
