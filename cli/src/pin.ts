import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  COMPONENT_MARKER,
  type Component,
  type ComponentPaths,
  discoverComponentsFromMarkers,
  readComponentMarker,
} from "./utils.js";

interface ProjxConfig {
  version: string;
  components: Component[];
  createdAt: string;
  skip?: string[];
}

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

export async function pin(
  cwd: string,
  patterns: string[],
): Promise<void> {
  p.intro("projx pin");

  const configPath = join(cwd, ".projx");
  if (!existsSync(configPath)) {
    p.log.error("No .projx file found. Run 'npx create-projx init' first.");
    process.exit(1);
  }

  const config: ProjxConfig = JSON.parse(await readFile(configPath, "utf-8"));
  const componentPaths = (await discoverComponentsFromMarkers(cwd)).paths;

  const rootAdds: string[] = [];
  const componentAdds: Record<string, string[]> = {};

  for (const pattern of patterns) {
    if (pattern === ".projx" || pattern.endsWith(COMPONENT_MARKER)) {
      p.log.warn(`Cannot pin ${pattern} — config files are managed by projx.`);
      continue;
    }

    const { scope, component, relative } = classifyPattern(pattern, componentPaths);

    if (scope === "component" && component) {
      if (!componentAdds[component]) componentAdds[component] = [];
      componentAdds[component].push(relative);
    } else {
      rootAdds.push(relative);
    }
  }

  // Write component skips
  for (const [component, additions] of Object.entries(componentAdds)) {
    const dir = componentPaths[component as Component];
    const markerPath = join(cwd, dir, COMPONENT_MARKER);
    try {
      const data = JSON.parse(await readFile(markerPath, "utf-8"));
      const existing: string[] = data.skip ?? [];
      const merged = [...new Set([...existing, ...additions])];
      const added = merged.length - existing.length;
      if (added > 0) {
        data.skip = merged;
        await writeFile(markerPath, JSON.stringify(data, null, 2) + "\n");
        p.log.success(`${component}: pinned ${additions.join(", ")}`);
      } else {
        p.log.info(`${component}: already pinned.`);
      }
    } catch {
      p.log.error(`Could not read marker for ${component}.`);
    }
  }

  // Write root skips
  if (rootAdds.length > 0) {
    const existing: string[] = config.skip ?? [];
    const merged = [...new Set([...existing, ...rootAdds])];
    const added = merged.length - existing.length;
    if (added > 0) {
      config.skip = merged;
      await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
      p.log.success(`root: pinned ${rootAdds.join(", ")}`);
    } else {
      p.log.info("root: already pinned.");
    }
  }

  p.outro("Skip list updated.");
}

export async function unpin(
  cwd: string,
  patterns: string[],
): Promise<void> {
  p.intro("projx unpin");

  const configPath = join(cwd, ".projx");
  if (!existsSync(configPath)) {
    p.log.error("No .projx file found. Run 'npx create-projx init' first.");
    process.exit(1);
  }

  const config: ProjxConfig = JSON.parse(await readFile(configPath, "utf-8"));
  const componentPaths = (await discoverComponentsFromMarkers(cwd)).paths;

  const rootRemoves: string[] = [];
  const componentRemoves: Record<string, string[]> = {};

  for (const pattern of patterns) {
    const { scope, component, relative } = classifyPattern(pattern, componentPaths);
    if (scope === "component" && component) {
      if (!componentRemoves[component]) componentRemoves[component] = [];
      componentRemoves[component].push(relative);
    } else {
      rootRemoves.push(relative);
    }
  }

  for (const [component, removals] of Object.entries(componentRemoves)) {
    const dir = componentPaths[component as Component];
    const markerPath = join(cwd, dir, COMPONENT_MARKER);
    try {
      const data = JSON.parse(await readFile(markerPath, "utf-8"));
      const existing: string[] = data.skip ?? [];
      const filtered = existing.filter((s) => !removals.includes(s));
      const removed = existing.length - filtered.length;
      if (removed > 0) {
        if (filtered.length > 0) {
          data.skip = filtered;
        } else {
          delete data.skip;
        }
        await writeFile(markerPath, JSON.stringify(data, null, 2) + "\n");
        p.log.success(`${component}: unpinned ${removals.join(", ")}`);
      } else {
        p.log.info(`${component}: not found in skip list.`);
      }
    } catch {
      p.log.error(`Could not read marker for ${component}.`);
    }
  }

  if (rootRemoves.length > 0) {
    const existing: string[] = config.skip ?? [];
    const filtered = existing.filter((s) => !rootRemoves.includes(s));
    const removed = existing.length - filtered.length;
    if (removed > 0) {
      if (filtered.length > 0) {
        config.skip = filtered;
      } else {
        delete config.skip;
      }
      await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
      p.log.success(`root: unpinned ${rootRemoves.join(", ")}`);
    } else {
      p.log.info("root: not found in skip list.");
    }
  }

  p.outro("Skip list updated.");
}

export async function listPins(cwd: string): Promise<void> {
  p.intro("projx pin --list");

  const configPath = join(cwd, ".projx");
  if (!existsSync(configPath)) {
    p.log.error("No .projx file found. Run 'npx create-projx init' first.");
    process.exit(1);
  }

  const config: ProjxConfig = JSON.parse(await readFile(configPath, "utf-8"));
  const { components: discovered, paths: componentPaths } = await discoverComponentsFromMarkers(cwd);

  let hasAny = false;

  // Root skips
  if (config.skip && config.skip.length > 0) {
    hasAny = true;
    p.log.info("root:");
    for (const s of config.skip) {
      p.log.info(`  ${s}`);
    }
  }

  // Component skips
  for (const component of discovered) {
    const dir = componentPaths[component];
    const marker = await readComponentMarker(join(cwd, dir));
    if (marker?.skip && marker.skip.length > 0) {
      hasAny = true;
      const label = dir !== component ? `${component} (${dir}/)` : `${component}`;
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
