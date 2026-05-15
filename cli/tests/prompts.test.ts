import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runPrompts, LABELS } from "../src/prompts.js";

vi.mock("@clack/prompts", () => {
  return {
    intro: vi.fn(),
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
    text: vi.fn(),
    multiselect: vi.fn(),
    select: vi.fn(),
    isCancel: (v: unknown) => v === Symbol.for("clack.cancel"),
  };
});

import * as p from "@clack/prompts";

describe("LABELS", () => {
  it("has an entry for every component", () => {
    expect(LABELS).toHaveProperty("fastapi");
    expect(LABELS).toHaveProperty("fastify");
    expect(LABELS).toHaveProperty("frontend");
    expect(LABELS).toHaveProperty("mobile");
    expect(LABELS).toHaveProperty("e2e");
    expect(LABELS).toHaveProperty("infra");
  });
});

describe("runPrompts", () => {
  const origExit = process.exit;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exit = origExit;
  });

  it("uses provided name and prompts for components and pm", async () => {
    vi.mocked(p.multiselect).mockResolvedValueOnce([
      "fastify",
      "frontend",
    ] as never);
    vi.mocked(p.select)
      .mockResolvedValueOnce("prisma" as never)
      .mockResolvedValueOnce("pnpm" as never);

    const opts = await runPrompts("my-app");

    expect(p.text).not.toHaveBeenCalled();
    expect(p.multiselect).toHaveBeenCalled();
    expect(p.select).toHaveBeenCalled();
    expect(opts).toEqual({
      name: "my-app",
      components: ["fastify", "frontend"],
      git: true,
      install: true,
      packageManager: "pnpm",
      orm: "prisma",
    });
  });

  it("prompts for project name when not provided and validates input", async () => {
    vi.mocked(p.text).mockResolvedValueOnce("clean-name" as never);
    vi.mocked(p.multiselect).mockResolvedValueOnce(["fastify"] as never);
    vi.mocked(p.select)
      .mockResolvedValueOnce("prisma" as never)
      .mockResolvedValueOnce("npm" as never);

    const opts = await runPrompts();
    expect(opts.name).toBe("clean-name");

    const validateCall = vi.mocked(p.text).mock.calls[0][0];
    const validate = validateCall.validate!;
    expect(validate("")).toBe("Required");
    expect(validate("Bad Name")).toBe("Lowercase, hyphens, no spaces");
    expect(validate("good-name")).toBeUndefined();
    expect(validate("a1")).toBeUndefined();
  });

  it("warns when no components are selected", async () => {
    vi.mocked(p.multiselect).mockResolvedValueOnce([] as never);

    const opts = await runPrompts("empty-app");

    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("No components"),
    );
    expect(opts.components).toEqual([]);
  });

  it("skips package-manager prompt when no JS component selected", async () => {
    vi.mocked(p.multiselect).mockResolvedValueOnce([
      "fastapi",
      "infra",
    ] as never);

    const opts = await runPrompts("py-only");

    expect(p.select).not.toHaveBeenCalled();
    expect(opts.packageManager).toBe("npm");
    expect(opts.orm).toBe("prisma");
    expect(opts.components).toEqual(["fastapi", "infra"]);
  });

  it("exits 0 when name prompt is cancelled", async () => {
    vi.mocked(p.text).mockResolvedValueOnce(
      Symbol.for("clack.cancel") as never,
    );
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("EXIT");
    });

    await expect(runPrompts()).rejects.toThrow("EXIT");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits 0 when components prompt is cancelled", async () => {
    vi.mocked(p.multiselect).mockResolvedValueOnce(
      Symbol.for("clack.cancel") as never,
    );
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("EXIT");
    });

    await expect(runPrompts("a")).rejects.toThrow("EXIT");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits 0 when package-manager prompt is cancelled", async () => {
    vi.mocked(p.multiselect).mockResolvedValueOnce(["fastify"] as never);
    vi.mocked(p.select)
      .mockResolvedValueOnce("prisma" as never)
      .mockResolvedValueOnce(Symbol.for("clack.cancel") as never);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("EXIT");
    });

    await expect(runPrompts("a")).rejects.toThrow("EXIT");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits 0 when ORM prompt is cancelled", async () => {
    vi.mocked(p.multiselect).mockResolvedValueOnce(["express"] as never);
    vi.mocked(p.select).mockResolvedValueOnce(
      Symbol.for("clack.cancel") as never,
    );
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("EXIT");
    });

    await expect(runPrompts("a")).rejects.toThrow("EXIT");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
