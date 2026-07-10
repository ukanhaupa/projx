# cli — `create-projx` CLI source (projx engine)

> Stack-scoped notes. The root [`../CLAUDE.md`](../CLAUDE.md) is the primary reference for the CLI's behavior (commands, template engine, ORM addons, feature templates) — this file carries the local dev shapes. Read both.
>
> Unlike the sibling stack dirs, `cli/` is **not** a copied template — it's the engine. It's excluded from the component copy (`EXCLUDE` in `src/utils.ts`) and is the only section that gates the CLI itself.

## Stack

- **Runtime** — Node, TypeScript **ESM**
- **Build** — `tsup` (`--format esm --target node18`)
- **Test** — Vitest + v8 coverage; **≥80% enforced** (statements/branches/functions/lines) in `vitest.config.ts`
- **Lint / format** — eslint + prettier
- **Published as** — `create-projx` (npm); `package.json#files` ships **only** `dist` + `src/templates`

## Layout

| Path                                                                                                                       | What it holds                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                                                                                             | `parseArgs` + subcommand dispatch (`create`/`update`/`add`/`init`/`pin`/`unpin`/`diff`/`doctor`/`gen`/`sync`)     |
| `src/scaffold.ts`                                                                                                          | Base scaffold flow (copy components, render templates, install)                                                   |
| `src/baseline.ts`                                                                                                          | `applyOrmAddon` — ORM addon dispatch (Node `packageOverrides` / Go `gomodOverrides`)                              |
| `src/gen.ts`                                                                                                               | Entity generators incl. `append<Orm>Entity`                                                                       |
| `src/features.ts`                                                                                                          | Feature-overlay application (`--<feature>=<targets>`)                                                             |
| `src/detect.ts`, `src/doctor.ts`, `src/diff.ts`, `src/sync.ts`, `src/pin.ts`, `src/init.ts`, `src/add.ts`, `src/update.ts` | One file per subcommand / concern                                                                                 |
| `src/prompts.ts`                                                                                                           | Interactive prompts (`@clack/prompts`)                                                                            |
| `src/utils.ts`                                                                                                             | Hand-rolled template engine (`render`), provider constants, copy filters (`EXCLUDE`/`EXCLUDE_FILES`), pm commands |
| `src/templates/*.ejs`                                                                                                      | Shared scaffold files rendered at scaffold time (ci.yml, setup.sh, docker-compose, pre-commit, README)            |
| `tests/*.test.ts`                                                                                                          | One suite per `src/` module                                                                                       |

## Conventions

- **The template engine is intentionally minimal** — `render()` in `src/utils.ts` supports only `<% if %>`, `<% for %>`, `<%= expr %>`. **Do not add a dependency on real EJS.**
- **Subcommands, flags, ORM addons, and feature templates** are documented once in root — extend there when adding behavior. Adding an ORM/feature touches `ORM_PROVIDERS`/`KNOWN_FEATURES` in `src/utils.ts` and the help string in `src/index.ts`.
- **Addons / features / component dirs are fetched from the repo tarball at runtime**, not bundled — use `--local <path>` during dev.

## Testing — the CLI test pattern

- **Never `vi.mock('@clack/prompts')`** — it pollutes the module cache across files. Spy on `utilsModule` instead (see existing suites).
- Mirror one `tests/<name>.test.ts` per `src/<name>.ts`. New behavior ships with a failing test first (root §"TDD").
- **The entrypoint guard is only exercisable via the built binary** — `tests/entrypoint.test.ts` runs `dist/index.js` **through a symlink** (the `npx`/`.bin` path); function-importing unit tests bypass it. Build first, and never assert CLI behavior only by real-path invocation.

## Quality gates (root §"Local development loop")

`pnpm --dir cli build` → `pnpm --dir cli exec tsc --noEmit` → `pnpm --dir cli exec eslint src/ tests/` → `pnpm --dir cli test` (vitest, v8 **≥80%**). Green or not done.

## Things that bite

- `pnpm exec` after a pipe (`| tail`/`head`) masks exit codes — use `${PIPESTATUS[0]}` or no pipe when verifying success.
- The 80% coverage threshold is hard — new `src/` code without tests drops the aggregate and fails the gate.
- **In production the CLI is only reached through a `bin` symlink** (`npx create-projx`, `npm create projx`, a global install → `node_modules/.bin/create-projx` → `dist/index.js`), but every gate invokes it by its **real path** (`node cli/dist/index.js` — the dev loop, `scripts/scaffold-fuzz.py`, the dispatch tests) or imports its functions directly. So an entrypoint break is invisible to CI. The `isMainEntrypoint()` guard in `src/index.ts` **must `realpathSync(process.argv[1])` before comparing to `import.meta.url`** — through a symlink the two differ, a naive compare is always false, and `main()` never runs, so every command silently exits 0 with no output. This was latent from v1.7.4 to v1.9.3. Regression-guarded by `tests/entrypoint.test.ts`.
