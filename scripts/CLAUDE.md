# scripts — projx repo CI / dev tooling

> Stack-scoped notes. The root [`../CLAUDE.md`](../CLAUDE.md) carries cross-cutting standards — read both, they compose.
>
> This dir holds the projx repo's own CI/dev scripts. Some setup scripts are also copied into scaffolded projects (root §layout: "Static scripts copied into scaffolded projects") — keep those project-agnostic. No package manifest; these are plain `bash` + one `python3`.

## What's here

| Script                                                        | Purpose                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci-local.sh`                                                 | Run every CI gate locally, **in parallel**. Sections auto-detected: `secrets cli fastapi fastify express frontend e2e infra scaffold_matrix`. Args: none (all), `changed` (only sections touched vs `origin/main` + working tree), or named sections. Knobs: `E2E_REAL_BACKEND`, `E2E_BACKEND_PORT`, `E2E_HEALTH_PATH`, `LOGS_DIR`. |
| `ci-scaffold-matrix.sh`                                       | Scaffold-matrix smoke — scaffolds combinations and checks they build                                                                                                                                                                                                                                                                |
| `ci-runner-gc.sh`                                             | CI runner disk/cache GC                                                                                                                                                                                                                                                                                                             |
| `check-bundle-size.sh` + `check-bundle-size.test.sh`          | Frontend bundle-size budget gate (+ its self-test)                                                                                                                                                                                                                                                                                  |
| `style-check.py`                                              | CSS discipline linter — flags raw `background`/`color` values and raw element selectors. The enforcer behind root §"CSS discipline"                                                                                                                                                                                                 |
| `validate-nginx-config.sh`                                    | Validates the nginx serving config (wired into CI)                                                                                                                                                                                                                                                                                  |
| `setup.sh`, `setup-aws.sh`, `setup-docker.sh`, `setup-ssl.sh` | Environment / deploy setup                                                                                                                                                                                                                                                                                                          |

## Conventions

- **Language choice** (root §"Script language choice"): `bash` for single-pass regex scans; **Python stdlib** for parsing / sets / multi-pass — which is why `style-check.py` is Python while the CI orchestration is bash.
- `ci-local.sh` is the single source for "what CI runs locally" — mirror new template gates into its section list rather than inventing a parallel runner.
- Bash scripts use `set -euo pipefail` (or `set -uo pipefail` where partial failures are aggregated, as in `ci-local.sh`).

## Gates

These scripts **are** the gates — they're invoked by CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)), `.githooks/pre-commit`, and developers locally. When editing one, run it end-to-end before committing; `check-bundle-size.sh` has a companion `.test.sh` — keep it green.
