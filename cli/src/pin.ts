import { existsSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  COMPONENT_MARKER,
  type Component,
  type ComponentMarkerData,
  type ComponentPaths,
  discoverComponentsFromMarkers,
  readComponentMarker,
  readProjxConfig,
  writeComponentMarker,
  writeProjxConfig,
} from "./utils.js";

function classifyPattern(
  pattern: string,
  componentPaths: ComponentPaths,
): { scope: "root" | "component"; component?: string; relative: string } {
  const dirToComponent: Record<string, string> = {};
  for (const [component, dir] of Object.entries(componentPaths)) {
    dirToComponent[dir] = component;
  }

  for (const [dir, component] of Object.entries(dirToComponent)) {
    if (pattern.startsWith(dir + "/")) {
      return {
        scope: "component",
        component,
        relative: pattern.slice(dir.length + 1),
      };
    }
  }

  return { scope: "root", relative: pattern };
}

export async function pin(cwd: string, patterns: string[]): Promise<void> {
  p.intro("projx pin");

  if (!existsSync(join(cwd, ".projx"))) {
    p.log.error("No .projx file found. Run 'npx create-projx init' first.");
    process.exit(1);
  }

  const config = await readProjxConfig(cwd);
  const componentPaths = (await discoverComponentsFromMarkers(cwd)).paths;

  const rootAdds: string[] = [];
  const componentAdds: Record<string, string[]> = {};

  for (const pattern of patterns) {
    if (pattern === ".projx" || pattern.endsWith(COMPONENT_MARKER)) {
      p.log.warn(`Cannot pin ${pattern} — config files are managed by projx.`);
      continue;
    }

    const { scope, component, relative } = classifyPattern(
      pattern,
      componentPaths,
    );

    if (scope === "component" && component) {
      if (!componentAdds[component]) componentAdds[component] = [];
      componentAdds[component].push(relative);
    } else {
      rootAdds.push(relative);
    }
  }

  for (const [component, additions] of Object.entries(componentAdds)) {
    const dir = componentPaths[component as Component];
    const marker = await readComponentMarker(join(cwd, dir));
    if (!marker) {
      p.log.error(`Could not read marker for ${component}.`);
      continue;
    }
    const merged = [...new Set([...marker.skip, ...additions])];
    const added = merged.length - marker.skip.length;
    if (added > 0) {
      const next: ComponentMarkerData = { ...marker, skip: merged };
      await writeComponentMarker(join(cwd, dir), next);
      p.log.success(`${component}: pinned ${additions.join(", ")}`);
    } else {
      p.log.info(`${component}: already pinned.`);
    }
  }

  if (rootAdds.length > 0) {
    const existing: string[] = Array.isArray(config.skip)
      ? (config.skip as string[])
      : [];
    const merged = [...new Set([...existing, ...rootAdds])];
    const added = merged.length - existing.length;
    if (added > 0) {
      await writeProjxConfig(cwd, { ...config, skip: merged });
      p.log.success(`root: pinned ${rootAdds.join(", ")}`);
    } else {
      p.log.info("root: already pinned.");
    }
  }

  p.outro("Skip list updated.");
}

export async function unpin(cwd: string, patterns: string[]): Promise<void> {
  p.intro("projx unpin");

  if (!existsSync(join(cwd, ".projx"))) {
    p.log.error("No .projx file found. Run 'npx create-projx init' first.");
    process.exit(1);
  }

  const config = await readProjxConfig(cwd);
  const componentPaths = (await discoverComponentsFromMarkers(cwd)).paths;

  const rootRemoves: string[] = [];
  const componentRemoves: Record<string, string[]> = {};

  for (const pattern of patterns) {
    const { scope, component, relative } = classifyPattern(
      pattern,
      componentPaths,
    );
    if (scope === "component" && component) {
      if (!componentRemoves[component]) componentRemoves[component] = [];
      componentRemoves[component].push(relative);
    } else {
      rootRemoves.push(relative);
    }
  }

  for (const [component, removals] of Object.entries(componentRemoves)) {
    const dir = componentPaths[component as Component];
    const marker = await readComponentMarker(join(cwd, dir));
    if (!marker) {
      p.log.error(`Could not read marker for ${component}.`);
      continue;
    }
    const filtered = marker.skip.filter((s) => !removals.includes(s));
    const removed = marker.skip.length - filtered.length;
    if (removed > 0) {
      const next: ComponentMarkerData = { ...marker, skip: filtered };
      await writeComponentMarker(join(cwd, dir), next);
      p.log.success(`${component}: unpinned ${removals.join(", ")}`);
    } else {
      p.log.info(`${component}: not found in skip list.`);
    }
  }

  if (rootRemoves.length > 0) {
    const existing: string[] = Array.isArray(config.skip)
      ? (config.skip as string[])
      : [];
    const filtered = existing.filter((s) => !rootRemoves.includes(s));
    const removed = existing.length - filtered.length;
    if (removed > 0) {
      await writeProjxConfig(cwd, { ...config, skip: filtered });
      p.log.success(`root: unpinned ${rootRemoves.join(", ")}`);
    } else {
      p.log.info("root: not found in skip list.");
    }
  }

  p.outro("Skip list updated.");
}

export async function listPins(cwd: string): Promise<void> {
  p.intro("projx pin --list");

  if (!existsSync(join(cwd, ".projx"))) {
    p.log.error("No .projx file found. Run 'npx create-projx init' first.");
    process.exit(1);
  }

  const config = await readProjxConfig(cwd);
  const { components: discovered, paths: componentPaths } =
    await discoverComponentsFromMarkers(cwd);

  let hasAny = false;

  const rootSkip: string[] = Array.isArray(config.skip)
    ? (config.skip as string[])
    : [];
  if (rootSkip.length > 0) {
    hasAny = true;
    p.log.info("root:");
    for (const s of rootSkip) {
      p.log.info(`  ${s}`);
    }
  }

  // Component skips
  for (const component of discovered) {
    const dir = componentPaths[component];
    const marker = await readComponentMarker(join(cwd, dir));
    if (marker?.skip && marker.skip.length > 0) {
      hasAny = true;
      const label =
        dir !== component ? `${component} (${dir}/)` : `${component}`;
      p.log.info(`${label}:`);
      for (const s of marker.skip) {
        p.log.info(`  ${s}`);
      }
    }
  }

  if (!hasAny) {
    p.log.info("No pinned files. All template files will be updated.");
  }

  p.outro("");
}
