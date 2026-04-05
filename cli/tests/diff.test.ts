import { describe, it, expect } from "vitest";
import { unifiedDiff } from "../src/diff.js";

describe("unifiedDiff", () => {
  it("shows header lines", () => {
    const result = unifiedDiff("a", "b", "test.txt");
    expect(result).toContain("--- existing test.txt");
    expect(result).toContain("+++ template test.txt");
  });

  it("shows identical content as context lines", () => {
    const result = unifiedDiff("same\nline", "same\nline", "f.txt");
    expect(result).toContain("  same");
    expect(result).toContain("  line");
    expect(result).not.toContain("\x1b[31m");
    expect(result).not.toContain("\x1b[32m");
  });

  it("shows removed lines in red", () => {
    const result = unifiedDiff("old\nshared", "shared", "f.txt");
    expect(result).toContain("\x1b[31m- old\x1b[0m");
    expect(result).toContain("  shared");
  });

  it("shows added lines in green", () => {
    const result = unifiedDiff("shared", "shared\nnew", "f.txt");
    expect(result).toContain("  shared");
    expect(result).toContain("\x1b[32m+ new\x1b[0m");
  });

  it("shows replacement diff", () => {
    const result = unifiedDiff("old line", "new line", "f.txt");
    expect(result).toContain("- old line");
    expect(result).toContain("+ new line");
  });

  it("truncates long diffs", () => {
    const a = Array.from({ length: 100 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 100 }, (_, i) => `b${i}`).join("\n");
    const result = unifiedDiff(a, b, "big.txt");
    expect(result).toContain("more lines");
  });

  it("handles empty existing file", () => {
    const result = unifiedDiff("", "new content", "f.txt");
    expect(result).toContain("+ new content");
  });

  it("handles empty template file", () => {
    const result = unifiedDiff("old content", "", "f.txt");
    expect(result).toContain("- old content");
  });
});
