# infra — Terraform / AWS infrastructure (projx template)

> Stack-scoped notes. The root [`../CLAUDE.md`](../CLAUDE.md) carries cross-cutting standards — read both, they compose.
>
> This directory is a **projx template**: the IaC + deploy plumbing copied into scaffolded projects. It targets AWS via Terraform and supports two runtimes — EKS (the `k8s/` path) and EC2 + Docker Compose (the `compose/` path).

## Stack

- **IaC** — Terraform `>= 1.11.0`
- **Providers** — AWS `~> 5.95`, Helm `~> 3.1`, Kubernetes `~> 3.0`, random `~> 3.8`
- **Cloud** — AWS; RDS Postgres; ECR; EKS or EC2 + Compose
- **Identity** — Keycloak (provisioned in `stack/k8s/keycloak.tf` + `environments/keycloak/`)
- **CI/CD** — AWS CodeBuild buildspecs in `cicd/`
- **Lint** — `tflint` (`stack/.tflint.hcl`)

## Layout

| Path                | What it holds                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `stack/*.tf`        | Root config: `versions`, `providers`, `backend`, `variables`, `locals`, `network`, `rds`, `eks`, `deployment`, `monitoring`, `cicd`, `outputs` |
| `stack/k8s/`        | EKS path: `apps`, `db-bootstrap`, `ingress`, `keycloak`, `scaling`                                                                             |
| `stack/compose/`    | EC2 + Docker Compose path: `main`, `variables`, `outputs`, `user-data.sh.tftpl`                                                                |
| `stack/.tflint.hcl` | tflint config                                                                                                                                  |
| `bin/`              | `tf`, `plan`, `apply`, `destroy`, `output` — env-aware wrappers                                                                                |
| `environments/`     | `dev.tfvars`, `staging.tfvars`, `prod.tfvars`, `keycloak/`; generated `<env>.tfplan`                                                           |
| `cicd/`             | `buildspec.{backend,frontend,infra,rollback}.yml`                                                                                              |
| `scripts/`          | `keep-recent-images.sh`, `rollback-compose.sh`, `setup-ssl.sh`                                                                                 |

## Conventions

- **One run = one environment, via `bin/tf <command> <env>`** (`plan` / `apply` / `destroy` / `output` / `exec`; env ∈ `dev`/`staging`/`prod`). The wrapper runs `terraform init` then the command with `-var-file=../environments/<env>.tfvars`, saving plans to `environments/<env>.tfplan`. **This stack uses var-files per env, not `terraform workspace`.**
- **Secrets never in code** — runtime creds resolve at boot, not committed plaintext. `.env.<env>` files are gitignored (and excluded from the CLI copy).
- **Variables carry `description` + `type`**; tag every resource (`Project`, `Environment`, `ManagedBy`).
- **Destructive resources** (RDS, KMS) get `lifecycle { prevent_destroy = true }` in prod.

## Quality gates

Run via [`scripts/ci-local.sh`](../scripts/ci-local.sh) `infra` section and `.githooks/pre-commit` on staged `*.tf`:

`terraform fmt -recursive` → `terraform validate` → `tflint` (config in `stack/.tflint.hcl`) → review `bin/tf plan <env>` before `bin/tf apply <env>`.

`terraform validate` needs providers initialized (`terraform init -backend=false` at minimum). Nginx serving config is validated separately by [`scripts/validate-nginx-config.sh`](../scripts/validate-nginx-config.sh).

## Things that bite

- A reviewed plan is mandatory before apply — never `bin/tf apply` an unreviewed diff against `staging`/`prod`.
- `prevent_destroy` blocking a destroy is the guard working, not a bug — don't disable it as a shortcut.
