#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { COMPONENTS, type Component, type Options } from "./utils.js";
import { runPrompts } from "./prompts.js";
import { scaffold } from "./scaffold.js";
import { update } from "./update.js";
import { add } from "./add.js";
import { init } from "./init.js";

const args = process.argv.slice(2);

interface ParsedArgs {
  command: "create" | "update" | "add" | "init";
  name?: string;
  options: Partial<Options>;
  localRepo?: string;
  extraArgs: string[];
}

function parseArgs(): ParsedArgs {
  let command: "create" | "update" | "add" | "init" = "create";
  let name: string | undefined;
  let localRepo: string | undefined;
  const options: Partial<Options> = {};
  const extraArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "update" && !name) {
      command = "update";
      continue;
    }

    if (arg === "add" && !name) {
      command = "add";
      continue;
    }

    if (arg === "init" && !name) {
      command = "init";
      continue;
    }

    if (arg === "--components") {
      const val = args[++i];
      if (val) {
        options.components = val.split(",").filter((c): c is Component =>
          COMPONENTS.includes(c as Component),
        );
      }
      continue;
    }

    if (arg === "--local") {
      localRepo = resolve(args[++i] || ".");
      continue;
    }

    if (arg === "--no-git") {
      options.git = false;
      continue;
    }
    if (arg === "--no-install") {
      options.install = false;
      continue;
    }

    if (arg === "-y" || arg === "--yes") {
      options.components = options.components ?? ["fastify", "frontend", "e2e"];
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (!arg.startsWith("-")) {
      if (command === "add") {
        extraArgs.push(arg);
      } else if (!name) {
        name = arg;
      }
    }
  }

  return { command, name, options, localRepo, extraArgs };
}

function printHelp(): void {
  console.log(`
  Usage:
    projx <name> [options]        Create a new project
    projx init                    Adopt existing project into projx
    projx add <components...>     Add components to existing project
    projx update                  Update scaffolding to latest

  Options:
    --components <list>  Comma-separated: fastapi,fastify,frontend,mobile,e2e,infra
    --no-git             Skip git init
    --no-install         Skip dependency installation
    -y, --yes            Accept defaults (fastify + frontend + e2e)
    --local <path>       Use local repo instead of downloading (dev only)
    -h, --help           Show this help

  Examples:
    npx create-projx my-app
    npx create-projx my-app --components fastapi,frontend,e2e
    npx create-projx my-app -y
    npx create-projx add frontend mobile
    npx create-projx@latest update
`);
}

async function main(): Promise<void> {
  const { command, name, options, localRepo, extraArgs } = parseArgs();

  if (command === "init") {
    await init(process.cwd(), localRepo);
    return;
  }

  if (command === "update") {
    await update(process.cwd(), localRepo);
    return;
  }

  if (command === "add") {
    const components = extraArgs.filter((c): c is Component =>
      COMPONENTS.includes(c as Component),
    );
    if (components.length === 0) {
      console.error(`Error: specify components to add. Available: ${COMPONENTS.join(", ")}`);
      process.exit(1);
    }
    await add(process.cwd(), components, localRepo, options.install === false);
    return;
  }

  let opts: Options;

  if (options.components) {
    if (!name) {
      console.error("Error: project name required. Usage: projx <name>");
      return process.exit(1);
    }
    opts = {
      name,
      components: options.components,
      git: options.git ?? true,
      install: options.install ?? true,
    };
  } else {
    opts = await runPrompts(name);
    opts.git = options.git ?? opts.git;
    opts.install = options.install ?? opts.install;
  }

  const dest = resolve(process.cwd(), opts.name);
  if (existsSync(dest)) {
    console.error(`Error: ${dest} already exists.`);
    process.exit(1);
  }

  await scaffold(opts, dest, localRepo);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
