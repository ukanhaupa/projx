#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMPONENTS,
  KNOWN_FEATURES,
  ORM_PROVIDERS,
  type Component,
  type Feature,
  type OrmProvider,
  type Options,
} from "./utils.js";
import { parseFeatureFlag } from "./features.js";
import { runPrompts } from "./prompts.js";
import { scaffold } from "./scaffold.js";
import { update } from "./update.js";
import { add } from "./add.js";
import { init } from "./init.js";
import { pin, unpin, listPins } from "./pin.js";
import { doctor } from "./doctor.js";
import { diff } from "./diff.js";
import { gen } from "./gen.js";
import { sync } from "./sync.js";

const args = process.argv.slice(2);

interface ParsedArgs {
  command:
    | "create"
    | "update"
    | "add"
    | "init"
    | "pin"
    | "unpin"
    | "diff"
    | "doctor"
    | "gen"
    | "sync";
  name?: string;
  options: Partial<Options>;
  localRepo?: string;
  extraArgs: string[];
  flags: {
    list?: boolean;
    fix?: boolean;
    ai?: boolean;
    backend?: boolean;
  };
}

function matchFeatureFlag(
  arg: string,
  argv: string[],
  i: number,
): { feature: Feature; value: string; consumedNext: boolean } | null {
  for (const feat of KNOWN_FEATURES) {
    const eq = `--${feat}=`;
    if (arg.startsWith(eq)) {
      return {
        feature: feat,
        value: arg.slice(eq.length),
        consumedNext: false,
      };
    }
    if (arg === `--${feat}`) {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(
          `Flag --${feat} requires a value. Use --${feat}=<targets> or --${feat} <targets>.`,
        );
      }
      return { feature: feat, value: next, consumedNext: true };
    }
  }
  return null;
}

function parseArgs(): ParsedArgs {
  let command: ParsedArgs["command"] = "create";
  let name: string | undefined;
  let localRepo: string | undefined;
  const options: Partial<Options> = {};
  const extraArgs: string[] = [];
  const flags: ParsedArgs["flags"] = {};

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
    if (arg === "pin" && !name) {
      command = "pin";
      continue;
    }
    if (arg === "unpin" && !name) {
      command = "unpin";
      continue;
    }
    if (arg === "diff" && !name) {
      command = "diff";
      continue;
    }
    if (arg === "doctor" && !name) {
      command = "doctor";
      continue;
    }
    if (arg === "gen" && !name) {
      command = "gen";
      continue;
    }
    if (arg === "sync" && !name) {
      command = "sync";
      continue;
    }

    if (arg === "--components") {
      const val = args[++i];
      if (val) {
        options.components = val
          .split(",")
          .filter((c): c is Component => COMPONENTS.includes(c as Component));
      }
      continue;
    }

    if (arg === "--orm") {
      const val = args[++i] as OrmProvider | undefined;
      if (!val || !ORM_PROVIDERS.includes(val)) {
        throw new Error(
          `Invalid --orm. Use one of: ${ORM_PROVIDERS.join(", ")}`,
        );
      }
      options.orm = val;
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

    if (arg === "--list" || arg === "-l") {
      flags.list = true;
      continue;
    }
    if (arg === "--fix") {
      flags.fix = true;
      continue;
    }
    if (arg === "--ai") {
      flags.ai = true;
      continue;
    }
    if (arg === "--backend") {
      flags.backend = true;
      continue;
    }

    if (arg === "--url") {
      const val = args[++i];
      if (val) extraArgs.push(`--url=${val}`);
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--fields") {
      const val = args[++i];
      if (val) extraArgs.push(`--fields=${val}`);
      continue;
    }

    if (arg === "--name") {
      const val = args[++i];
      if (val) extraArgs.push(`--name=${val}`);
      continue;
    }

    {
      const featureMatch = matchFeatureFlag(arg, args, i);
      if (featureMatch) {
        const { feature, value, consumedNext } = featureMatch;
        parseFeatureFlag(value);
        options.features = { ...(options.features ?? {}), [feature]: value };
        if (consumedNext) i++;
        continue;
      }
    }

    if (!arg.startsWith("-")) {
      if (
        command === "add" ||
        command === "pin" ||
        command === "unpin" ||
        command === "gen"
      ) {
        extraArgs.push(arg);
      } else if (!name) {
        name = arg;
      }
    }
  }

  return { command, name, options, localRepo, extraArgs, flags };
}

function printHelp(): void {
  console.log(`
  Usage:
    projx <name> [options]        Create a new project
    projx init                    Adopt existing project into projx
    projx add <components...>     Add components to existing project
    projx add <type> --name <dir> Add another instance of <type> at <dir>
    projx update                  Update scaffolding to latest
    projx diff                    Preview what update would change
    projx pin <patterns...>       Skip files on future updates
    projx unpin <patterns...>     Remove files from skip list
    projx pin --list              Show all skip patterns
    projx doctor [--fix]          Health check for projx project
    projx gen entity <name>       Generate a new entity
    projx sync [--url <url>]      Sync types from running backend

  Options:
    --components <list>  Comma-separated: fastapi,fastify,express,frontend,mobile,e2e,infra
    --orm <provider>     Node backend ORM: prisma (default), drizzle
    --auth <targets>     Add auth feature. Targets: <component>[:<instance>] (comma-separated)
    --no-git             Skip git init
    --no-install         Skip dependency installation
    -y, --yes            Accept defaults (fastify + frontend + e2e)
    --local <path>       Use local repo instead of downloading (dev only)
    -h, --help           Show this help

  Examples:
    npx create-projx my-app
    npx create-projx my-app --components fastapi,frontend,e2e
    npx create-projx my-app --components express,frontend,e2e --orm drizzle
    npx create-projx my-app --components fastify,frontend,mobile --auth fastify,frontend,mobile
    npx create-projx my-app -y
    npx create-projx add frontend mobile
    npx create-projx add fastify --name email-ingestor
    npx create-projx@latest update
    npx create-projx diff
    npx create-projx pin backend/pyproject.toml
    npx create-projx doctor --fix
    npx create-projx gen entity invoice
    npx create-projx gen entity invoice --fields "name:string,amount:number,status:string"
`);
}

async function main(): Promise<void> {
  const { command, name, options, localRepo, extraArgs, flags } = parseArgs();

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
      console.error(
        `Error: specify components to add. Available: ${COMPONENTS.join(", ")}`,
      );
      process.exit(1);
    }
    const customName = extraArgs
      .find((a) => a.startsWith("--name="))
      ?.slice("--name=".length);
    if (customName && components.length > 1) {
      console.error(
        "Error: --name can only be used when adding a single component type.",
      );
      process.exit(2);
    }
    await add(
      process.cwd(),
      components,
      localRepo,
      options.install === false,
      customName,
    );
    return;
  }

  if (command === "pin") {
    if (flags.list || extraArgs.length === 0) {
      await listPins(process.cwd());
    } else {
      await pin(process.cwd(), extraArgs);
    }
    return;
  }

  if (command === "unpin") {
    if (extraArgs.length === 0) {
      console.error(
        "Error: specify patterns to unpin. Usage: projx unpin <patterns...>",
      );
      process.exit(1);
    }
    await unpin(process.cwd(), extraArgs);
    return;
  }

  if (command === "diff") {
    await diff(process.cwd(), localRepo);
    return;
  }

  if (command === "doctor") {
    await doctor(process.cwd(), flags.fix);
    return;
  }

  if (command === "sync") {
    const urlArg = extraArgs.find((a) => a.startsWith("--url="));
    const url = urlArg ? urlArg.split("=").slice(1).join("=") : undefined;
    await sync(process.cwd(), url);
    return;
  }

  if (command === "gen") {
    const subcommand = extraArgs[0];
    if (subcommand !== "entity" || !extraArgs[1]) {
      console.error(
        'Usage: projx gen entity <name> [--fields "name:string,amount:number"]',
      );
      process.exit(1);
    }
    const entityName = extraArgs[1];
    const fieldsArg = extraArgs.find((a) => a.startsWith("--fields="));
    const fieldsFlag = fieldsArg
      ? fieldsArg.split("=").slice(1).join("=")
      : undefined;
    const backendFlag = flags.ai
      ? ("fastapi" as const)
      : flags.backend
        ? ("fastify" as const)
        : undefined;
    await gen(process.cwd(), entityName, fieldsFlag, backendFlag);
    return;
  }

  // Default: create
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
      orm: options.orm ?? "prisma",
      features: options.features,
    };
  } else {
    opts = await runPrompts(name);
    opts.git = options.git ?? opts.git;
    opts.install = options.install ?? opts.install;
    opts.orm = options.orm ?? opts.orm ?? "prisma";
    opts.features = options.features ?? opts.features;
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
