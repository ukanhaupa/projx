# Terraform Infrastructure Stack

Reusable Terraform stack supporting two deployment modes (`k8s` and `compose`) across three
environments (`dev`, `staging`, `prod`).

## Deployment Modes

| Mode | Infrastructure |
|------|---------------|
| `k8s` | EKS cluster + ALB ingress + Kubernetes workloads + Fluent Bit → CloudWatch |
| `compose` | Single EC2 instance — all services (backend + frontend + Keycloak + nginx) via Docker Compose + awslogs → CloudWatch |

## Quick Start

1. Copy `.env.example` to `.env.<env>` and fill in your values:
   ```sh
   cp .env.example .env.dev
   # edit .env.dev — set AWS creds, project name, secrets
   ```

2. Run plan/apply from the repo root:
   ```sh
   ./bin/plan  dev
   ./bin/apply dev
   ```

## Variable Sources

| Source | Contains |
|--------|----------|
| `.env.<env>` | AWS credentials, `TF_VAR_project`, secrets (`keycloak_client_secret`, `backend_db_password`, `db_reader_password`), feature flags (`enable_keycloak`, `cicd_enabled`), access CIDRs |
| `environments/<env>.tfvars` | Topology only — instance sizes, node counts, DB class, multi-AZ, Keycloak behaviour flags |

Values derived automatically from `TF_VAR_project` (override via `.env` if needed):

| Variable | Default |
|----------|---------|
| `keycloak_realm_name` | `<project>-<environment>` |
| `keycloak_client_id` | `<project>-backend` |
| `backend_db_name` | `<project>` (hyphens → underscores) |
| `cicd_codecommit_repository_name` | `<project>` |
| `cicd_region` | same as `aws_region` |

## S3 Remote State (Dynamic)

The `bin/tf` script generates the backend config at runtime from `.env.<env>`:

- **bucket**: `<project>-<region>-<account_id>`
- **key**: `terraform/state/<env>/<mode>.tfstate`
- **use_lockfile**: `true` (S3-native locking, no DynamoDB required — Terraform ≥ 1.10)

Dev, staging, and prod states never collide. k8s and compose states are separate keys.

### Manual init (without bin/tf)

```sh
terraform init \
  -backend-config="bucket=my-project-uswest1-123456789012" \
  -backend-config="key=terraform/state/dev/k8s.tfstate" \
  -backend-config="region=us-west-1" \
  -backend-config="encrypt=true" \
  -backend-config="use_lockfile=true" \
  -reconfigure
```

## CI/CD (CodePipeline + CodeBuild)

Enabled per-environment via `TF_VAR_cicd_enabled=true` in `.env.<env>`.

| Environment | Branch watched |
|-------------|---------------|
| `dev` | `develop` |
| `staging` | `staging` |
| `prod` | `main` |

Each push to the watched branch triggers the pipeline automatically via EventBridge.
The pipeline builds and deploys backend and frontend independently — only the service with
changed files under `fastapi/` or `frontend/` is rebuilt.

**k8s deploy**: `kubectl set image` + rollout status
**compose deploy**: SSM `RunCommand` → `docker-compose pull && up -d --no-deps`

Buildspecs live in `infra/cicd/buildspec.backend.yml` and `infra/cicd/buildspec.frontend.yml`.
The CodeCommit repository name defaults to `<project>` (override via `cicd_codecommit_repository_name`).

## Keycloak

Controlled by `TF_VAR_enable_keycloak=true/false` in `.env.<env>`.

- Realm, client, roles, and groups are configured via `environments/keycloak/realm.template.json.tftpl`
- Groups are defined in `environments/keycloak/groups.common.json`
- Dev seed users in `environments/keycloak/dev-users.json` (staging/prod use `empty-users.json`)

In **k8s** mode: deployed as a Helm release (Bitnami chart), config-cli handles realm import.
In **compose** mode: runs as a container on the EC2 host at `/auth/`.
