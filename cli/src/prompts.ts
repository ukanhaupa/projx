import * as p from "@clack/prompts";
import { COMPONENTS, type Component, type Options } from "./utils.js";

const LABELS: Record<Component, { label: string; hint: string }> = {
  fastapi: { label: "FastAPI", hint: "Python — SQLAlchemy, Alembic, uvicorn" },
  fastify: { label: "Fastify", hint: "Node.js — Prisma, TypeBox, TypeScript" },
  frontend: { label: "Frontend", hint: "React 19 + Vite + React Router" },
  mobile: { label: "Mobile", hint: "Flutter + Riverpod + GoRouter" },
  e2e: { label: "E2E Tests", hint: "Playwright" },
  infra: { label: "Infrastructure", hint: "Terraform + AWS" },
};

const DEFAULTS: Component[] = ["fastify", "frontend", "e2e"];

export async function runPrompts(nameArg?: string): Promise<Options> {
  p.intro("projx");

  const name =
    nameArg ??
    ((await p.text({
      message: "Project name",
      placeholder: "my-app",
      validate: (v) => {
        if (!v) return "Required";
        if (!/^[a-z0-9][a-z0-9-]*$/.test(v))
          return "Lowercase, hyphens, no spaces";
      },
    })) as string);

  if (p.isCancel(name)) process.exit(0);

  const components = (await p.multiselect({
    message: "Which components?",
    options: COMPONENTS.map((c) => ({
      value: c,
      label: LABELS[c].label,
      hint: LABELS[c].hint,
    })),
    initialValues: DEFAULTS,
    required: false,
  })) as Component[];

  if (p.isCancel(components)) process.exit(0);

  if (components.length === 0) {
    p.log.warn("No components selected. Creating an empty project.");
  }

  return { name, components, git: true, install: true };
}
