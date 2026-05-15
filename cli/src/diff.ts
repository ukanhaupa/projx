import { existsSync } from "node:fs";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as p from "@clack/prompts";
import {
  type ComponentPaths,
  cleanupRepo,
  detectProjectName,
  discoverComponentsFromMarkers,
  downloadRepo,
  pmCommands,
  readComponentMarker,
  readProjxConfig,
} from "./utils.js";
import {
  collectAllFiles,
  getBaselineRef,
  getFileAtRef,
  matchesSkip,
  writeTemplateToDir,
  type GeneratorVars,
} from "./baseline.js";

type FileStatus =
  | "new"
  | "unchanged"
  | "clean-update"
  | "user-only"
  | "needs-merge"
  | "skipped";

interface FileAnalysis {
  file: string;
  status: FileStatus;
  component?: string;
}

function isSkipped(
  file: string,
  componentPaths: ComponentPaths,
  componentSkips: Record<string, string[]>,
  rootSkip: string[],
): boolean {
  for (const [component, dir] of Object.entries(componentPaths)) {
    if (file.startsWith(dir + "/")) {
      const relative = file.slice(dir.length + 1);
      const skips = componentSkips[component] ?? [];
      if (matchesSkip(relative, skips)) return true;
    }
  }
  const base = file.split("/").pop()!;
  if (base === ".projx" || base === ".projx-component") return false;
  return matchesSkip(file, rootSkip);
}

function fileComponent(
  file: string,
  componentPaths: ComponentPaths,
): string | undefined {
  for (const [component, dir] of Object.entries(componentPaths)) {
    if (file.startsWith(dir + "/")) return component;
  }
  return undefined;
}

export async function diff(cwd: string, localRepo?: string): Promise<void> {
  p.intro("projx diff");
  const isLocal = !!localRepo;

  if (!existsSync(join(cwd, ".projx"))) {
    p.log.error("No .projx file found. Run 'npx create-projx init' first.");
    process.exit(1);
  }

  const raw = await readProjxConfig(cwd);
  const { components, paths: componentPaths } =
    await discoverComponentsFromMarkers(cwd);

  const componentSkips: Record<string, string[]> = {};
  for (const component of components) {
    const dir = componentPaths[component];
    const marker = await readComponentMarker(join(cwd, dir));
    if (marker?.skip && marker.skip.length > 0) {
      componentSkips[component] = marker.skip;
    }
  }
  const rootSkip: string[] = Array.isArray(raw.skip)
    ? (raw.skip as string[])
    : [];

  const dlSpinner = p.spinner();
  dlSpinner.start(
    isLocal ? "Using local templates" : "Downloading latest templates",
  );
  const repoDir = await downloadRepo(localRepo).catch((err) => {
    dlSpinner.stop("Failed.");
    p.log.error(String(err));
    process.exit(1);
  });
  dlSpinner.stop(isLocal ? "Local templates loaded." : "Templates downloaded.");

  try {
    const pkg = JSON.parse(
      await readFile(join(repoDir, "cli/package.json"), "utf-8"),
    );
    const version = pkg.version;

    p.log.info(`Current: v${raw.version ?? "unknown"} → Template: v${version}`);

    const name = detectProjectName(cwd, components, componentPaths);
    const vars: GeneratorVars = {
      projectName: name,
      components,
      paths: componentPaths,
      pm: pmCommands((raw.packageManager ?? "npm") as "npm"),
      orm: raw.orm ?? "prisma",
    };

    const spinner = p.spinner();
    spinner.start("Analyzing changes");

    const tmpTemplate = await mkdtemp(join(tmpdir(), "projx-diff-"));
    await writeTemplateToDir(
      tmpTemplate,
      repoDir,
      components,
      componentPaths,
      vars,
      version,
      {
        componentSkips,
        rootSkip,
        realCwd: cwd,
      },
    );

    const baselineRef = getBaselineRef(cwd);
    const templateFiles = await collectAllFiles(tmpTemplate, tmpTemplate);

    const analyses: FileAnalysis[] = [];

    for (const file of templateFiles) {
      const component = fileComponent(file, componentPaths);

      if (isSkipped(file, componentPaths, componentSkips, rootSkip)) {
        analyses.push({ file, status: "skipped", component });
        continue;
      }

      const oursPath = join(cwd, file);
      if (!existsSync(oursPath)) {
        analyses.push({ file, status: "new", component });
        continue;
      }

      let oursContent: string;
      let theirsContent: string;
      try {
        oursContent = await readFile(oursPath, "utf-8");
        theirsContent = await readFile(join(tmpTemplate, file), "utf-8");
      } catch {
        continue;
      }

      if (oursContent === theirsContent) {
        analyses.push({ file, status: "unchanged", component });
        continue;
      }

      if (!baselineRef) {
        analyses.push({ file, status: "needs-merge", component });
        continue;
      }

      const baseContent = getFileAtRef(cwd, baselineRef, file);
      if (!baseContent) {
        analyses.push({ file, status: "needs-merge", component });
        continue;
      }

      if (oursContent === baseContent) {
        analyses.push({ file, status: "clean-update", component });
      } else if (theirsContent === baseContent) {
        analyses.push({ file, status: "user-only", component });
      } else {
        analyses.push({ file, status: "needs-merge", component });
      }
    }

    await rm(tmpTemplate, { recursive: true, force: true });
    spinner.stop("Analysis complete.");

    // Print results
    const groups: Record<FileStatus, FileAnalysis[]> = {
      new: [],
      "clean-update": [],
      "needs-merge": [],
      "user-only": [],
      unchanged: [],
      skipped: [],
    };

    for (const a of analyses) {
      groups[a.status].push(a);
    }

    if (groups["new"].length > 0) {
      p.log.info(`New files (${groups["new"].length}):`);
      for (const a of groups["new"]) p.log.info(`  + ${a.file}`);
    }

    if (groups["clean-update"].length > 0) {
      p.log.success(
        `Clean updates — auto-merged (${groups["clean-update"].length}):`,
      );
      for (const a of groups["clean-update"]) p.log.info(`  ~ ${a.file}`);
    }

    if (groups["needs-merge"].length > 0) {
      p.log.warn(
        `Needs merge — both sides changed (${groups["needs-merge"].length}):`,
      );
      for (const a of groups["needs-merge"]) p.log.info(`  ! ${a.file}`);
    }

    if (groups["user-only"].length > 0) {
      p.log.info(
        `User-modified only — no template change (${groups["user-only"].length}):`,
      );
      for (const a of groups["user-only"]) p.log.info(`  = ${a.file}`);
    }

    if (groups["skipped"].length > 0) {
      p.log.info(`Skipped (${groups["skipped"].length}):`);
      for (const a of groups["skipped"]) p.log.info(`  - ${a.file}`);
    }

    const unchanged = groups["unchanged"].length;
    if (unchanged > 0) {
      p.log.info(`${unchanged} file(s) unchanged.`);
    }

    const total = analyses.length - unchanged;
    if (total === 0) {
      p.outro("Everything is up to date.");
    } else {
      p.outro(`${total} file(s) would be affected by update.`);
    }
  } finally {
    await cleanupRepo(repoDir, isLocal);
  }
}
