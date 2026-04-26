import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type Component, EXCLUDE, readFileOrNull } from "./utils.js";

export interface DetectedComponent {
  component: Component;
  directory: string;
  confidence: "high" | "medium";
  evidence: string;
}

export async function detectComponents(
  cwd: string,
): Promise<DetectedComponent[]> {
  const results: DetectedComponent[] = [];
  const entries = await readdir(cwd, { withFileTypes: true });

  const dirs = entries
    .filter(
      (e) => e.isDirectory() && !e.name.startsWith(".") && !EXCLUDE.has(e.name),
    )
    .map((e) => e.name);

  for (const dir of dirs) {
    const full = join(cwd, dir);
    const detections = await scanDirectory(full, dir);
    results.push(...detections);
  }

  return results;
}

async function scanDirectory(
  dir: string,
  relPath: string,
): Promise<DetectedComponent[]> {
  const results: DetectedComponent[] = [];

  const pyproject = await readFileOrNull(join(dir, "pyproject.toml"));
  if (pyproject && /fastapi/i.test(pyproject)) {
    results.push({
      component: "fastapi",
      directory: relPath,
      confidence: "high",
      evidence: "pyproject.toml has fastapi dependency",
    });
  }

  const pkg = await readPkg(dir);
  if (pkg) {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps.fastify) {
      results.push({
        component: "fastify",
        directory: relPath,
        confidence: "high",
        evidence: "package.json has fastify dependency",
      });
    }

    if (allDeps.react || allDeps["react-dom"]) {
      results.push({
        component: "frontend",
        directory: relPath,
        confidence: "high",
        evidence: "package.json has react dependency",
      });
    }

    if (allDeps["@playwright/test"] || allDeps.playwright) {
      results.push({
        component: "e2e",
        directory: relPath,
        confidence: "high",
        evidence: "package.json has playwright dependency",
      });
    }
  }

  const pubspec = await readFileOrNull(join(dir, "pubspec.yaml"));
  if (pubspec && /flutter:/i.test(pubspec)) {
    results.push({
      component: "mobile",
      directory: relPath,
      confidence: "high",
      evidence: "pubspec.yaml has flutter dependency",
    });
  }

  const hasTf =
    existsSync(join(dir, "main.tf")) ||
    existsSync(join(dir, "variables.tf")) ||
    existsSync(join(dir, "stack/main.tf")) ||
    existsSync(join(dir, "versions.tf"));
  if (hasTf) {
    results.push({
      component: "infra",
      directory: relPath,
      confidence: "high",
      evidence: "Terraform .tf files found",
    });
  }

  return results;
}

async function readPkg(
  dir: string,
): Promise<{
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | null> {
  const content = await readFileOrNull(join(dir, "package.json"));
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}
