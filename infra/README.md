# Infrastructure

Terraform IaC for AWS plus Docker Compose workflows for local development and production. Supports two deployment modes (`k8s` or `compose`) across three environments (`dev`, `staging`, `prod`).

## Quick Start

```bash
cp .env.example .env.dev       # fill in AWS credentials + secrets
./bin/tf plan dev              # preview changes
./bin/tf apply dev             # deploy
./bin/tf destroy dev           # teardown
```

## Architecture

```
infra/
├── bin/                                # CLI wrappers
│   ├── tf                              # Main script — validates tools, loads env, runs terraform
│   ├── plan                            # Shortcut: tf plan <env>
│   ├── apply                           # Shortcut: tf apply <env>
│   ├── destroy                         # Shortcut: tf destroy <env>
│   └── output                          # Shortcut: tf output <env>
├── stack/                              # Root Terraform configuration
│   ├── versions.tf                     # Provider version constraints
│   ├── providers.tf                    # AWS + Kubernetes + Helm providers
│   ├── variables.tf                    # All input variables
│   ├── locals.tf                       # Computed values
│   ├── network.tf                      # VPC, subnets, NAT, security groups
│   ├── rds.tf                          # PostgreSQL RDS
│   ├── eks.tf                          # EKS cluster (k8s mode)
│   ├── backend.tf                      # S3 backend config (injected by bin/tf)
│   ├── deployment.tf                   # Orchestrates k8s or compose module
│   ├── cicd.tf                         # CodePipeline + CodeBuild + ECR
│   ├── monitoring.tf                   # CloudWatch alarms, SNS alerts, dashboard
│   ├── outputs.tf                      # Exported values
│   ├── compose/                        # Compose-mode submodule
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── user-data.sh.tftpl          # EC2 user-data template
│   └── k8s/                            # K8s-mode submodule
│       ├── apps.tf                     # Backend + frontend deployments
│       ├── keycloak.tf                 # Keycloak Helm release
│       ├── ingress.tf                  # ALB ingress
│       ├── db-bootstrap.tf             # DB user/schema creation
│       ├── variables.tf
│       └── outputs.tf
├── environments/
│   ├── dev.tfvars                      # Dev config
│   ├── staging.tfvars                  # Staging config
│   ├── prod.tfvars                     # Production config
│   └── keycloak/                       # Realm templates and user seed files
├── cicd/
│   ├── buildspec.backend.yml           # Backend build + deploy pipeline
│   ├── buildspec.frontend.yml          # Frontend build + deploy pipeline
│   └── buildspec.infra.yml             # Infra lint, validate, plan/apply pipeline
└── .env.example / .env.<env>           # Secrets per environment (gitignored)

(project root)
├── docker-compose.yml                  # Production: migrate → backend → frontend (nginx)
├── docker-compose.dev.yml              # Development: db → migrate → backend (reload) → frontend (node dev)
├── scripts/
│   └── setup-ssl.sh                    # Let's Encrypt certificate issuance
├── fastapi/
│   ├── Dockerfile                      # Python 3.12 + uv, includes migrate.py
│   └── migrate.py                      # Standalone Alembic migration runner
└── frontend/
    ├── Dockerfile                      # Multi-stage: node build → nginx + openssl
    ├── nginx.conf                      # No hardcoded domain; SSL at /etc/nginx/ssl/
    └── docker-entrypoint.sh            # DOMAIN env handling, self-signed fallback
```

## Docker Compose: Production

**File:** `docker-compose.yml` (project root)

Startup order enforced via `depends_on` conditions:

```
migrate (run-once) ──success──► backend (healthcheck) ──healthy──► frontend (nginx)
```

| Service    | Image / Build | Ports           | Notes                                                             |
| ---------- | ------------- | --------------- | ----------------------------------------------------------------- |
| `migrate`  | `./fastapi`   | none            | Runs `uv run migrate.py` then exits. Must succeed before backend. |
| `backend`  | `./fastapi`   | 7860 (internal) | Gunicorn + Uvicorn workers. Healthcheck on `/api/health`.         |
| `frontend` | `./frontend`  | 80, 443         | Nginx reverse-proxies `/api/` to `backend:7860`. Serves SPA.      |

Environment is supplied via `fastapi/.env`. The frontend reads `DOMAIN` (defaults to `localhost`) to configure SSL certificates.

```bash
# Start production stack
docker compose up -d --build

# With a custom domain
DOMAIN=example.com docker compose up -d --build
```

## Docker Compose: Development

**File:** `docker-compose.dev.yml` (project root)

```
db (postgres) ──healthy──► migrate ──success──► backend (with --reload) ──started──► frontend (node dev)
```

| Service    | Image                | Ports | Notes                                                      |
| ---------- | -------------------- | ----- | ---------------------------------------------------------- |
| `db`       | `postgres:16-alpine` | 5432  | Local Postgres. Credentials: `dev`/`dev`, database `app`.  |
| `migrate`  | `./fastapi`          | none  | Same migration script; connects to local db.               |
| `backend`  | `./fastapi`          | 7860  | Gunicorn with `--reload`. Source mounted for live changes. |
| `frontend` | `node:20-alpine`     | 3000  | Vite dev server (`npm run dev`). Source mounted.           |

Backend volumes mount `./fastapi/src`, `alembic.ini`, and `migrate.py` for hot-reload. Frontend mounts the entire `./frontend` directory with a named volume for `node_modules`.

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

Auth is configured with `JWT_PROVIDER=shared_secret` and a static `JWT_SECRET` for development.

## SSL / HTTPS

### How it works

The frontend container's entrypoint (`docker-entrypoint.sh`) handles SSL automatically:

1. Checks for a Let's Encrypt certificate at `/etc/letsencrypt/live/$DOMAIN/`.
2. If found, symlinks it to `/etc/nginx/ssl/`.
3. If not found, generates a self-signed certificate for `$DOMAIN`.

The nginx config (`nginx.conf`) references `/etc/nginx/ssl/fullchain.pem` and `/etc/nginx/ssl/privkey.pem` without any hardcoded domain. Port 80 redirects all traffic to HTTPS, with an exception for ACME challenge paths used by Certbot.

### Without a domain (development)

```bash
docker compose up -d
```

A self-signed certificate is generated for `localhost`. Browsers will show a certificate warning.

### With a domain (production)

```bash
# 1. Start with your domain
DOMAIN=example.com docker compose up -d

# 2. Issue a Let's Encrypt certificate
./scripts/setup-ssl.sh example.com admin@example.com
```

`setup-ssl.sh` performs the following:

- Verifies the frontend container is running.
- Checks DNS resolution and warns on IP mismatches.
- Runs Certbot via Docker using the `letsencrypt` and `certbot-www` volumes.
- Restarts the frontend container to pick up the new certificate.
- Installs a daily cron job (3 AM) for automatic certificate renewal.

### DOMAIN environment variable

`DOMAIN` is passed to the frontend service in `docker-compose.yml` and defaults to `localhost`. It controls:

- The SSL certificate CN (self-signed) or Let's Encrypt domain.
- The Let's Encrypt live directory path checked at container startup.

## Terraform Deployment Modes

### Kubernetes (`k8s`)

EKS cluster with ALB ingress, managed node groups, and Helm-based deployments. Keycloak is deployed via the Bitnami Helm chart. Backend and frontend run as Kubernetes Deployments in a configurable namespace (default: `apps`).

Set in `.env.<env>`: `TF_VAR_deployment_mode=k8s`

### Docker Compose (`compose`)

Single EC2 instance running all services via Docker Compose. An EC2 user-data template provisions the instance. Lower cost, simpler operations. Good for dev/staging or low-traffic production.

Set in `.env.<env>`: `TF_VAR_deployment_mode=compose`

### Shared resources (both modes)

- VPC with public/private/database subnets, NAT gateway, security groups (`network.tf`)
- PostgreSQL RDS with configurable Multi-AZ, storage autoscaling, enhanced monitoring, and optional public access (`rds.tf`)
- CI/CD pipeline when `cicd_enabled=true` (`cicd.tf`)
- CloudWatch alarms, SNS alerts topic, and dashboard (`monitoring.tf`)

## Configuration

### Key variables

| Variable                     | Default         | Description                                       |
| ---------------------------- | --------------- | ------------------------------------------------- |
| `project`                    | (required)      | Project name prefix for all resources             |
| `environment`                | `dev`           | One of `dev`, `staging`, `prod`                   |
| `deployment_mode`            | `compose`       | `k8s` (EKS) or `compose` (EC2 + Docker)           |
| `aws_region`                 | (required)      | AWS deployment region                             |
| `vpc_cidr`                   | `10.50.0.0/16`  | CIDR block for the VPC                            |
| `public_access_cidrs`        | `[]`            | CIDRs allowed to reach the EKS API endpoint       |
| `db_public_access_cidrs`     | `[]`            | CIDRs allowed to reach RDS directly (when public) |
| `db_instance_class`          | `db.t4g.micro`  | RDS instance class                                |
| `db_multi_az`                | `false`         | Enable Multi-AZ for RDS                           |
| `db_publicly_accessible`     | `false`         | Whether RDS is publicly accessible                |
| `kubernetes_version`         | `1.32`          | EKS Kubernetes version                            |
| `node_instance_types`        | `["t3.medium"]` | EKS managed node instance types                   |
| `node_desired_size`          | `2`             | Desired node count                                |
| `enable_keycloak`            | `true`          | Deploy Keycloak identity provider                 |
| `cicd_enabled`               | `true`          | Deploy CodePipeline + CodeBuild + ECR             |
| `compose_instance_type`      | `t3.medium`     | EC2 instance type for compose host                |
| `compose_ssh_allowed_cidr`   | `""`            | CIDR for SSH access (empty disables SSH ingress)  |
| `backend_cors_allow_origins` | `""`            | CORS origins for backend                          |
| `backend_replicas`           | `1`             | Backend deployment replica count                  |
| `frontend_replicas`          | `1`             | Frontend deployment replica count                 |

### Sensitive variables (set via `.env.<env>`)

| Variable                        | Description                              |
| ------------------------------- | ---------------------------------------- |
| `TF_VAR_keycloak_client_secret` | OIDC client secret for backend API       |
| `TF_VAR_db_reader_password`     | Password for shared read-only DB user    |
| `TF_VAR_backend_db_password`    | Password for backend application DB user |

## Environments

| Environment | Branch    | tfvars                        | Secrets file   |
| ----------- | --------- | ----------------------------- | -------------- |
| `dev`       | `develop` | `environments/dev.tfvars`     | `.env.dev`     |
| `staging`   | `staging` | `environments/staging.tfvars` | `.env.staging` |
| `prod`      | `main`    | `environments/prod.tfvars`    | `.env.prod`    |

Each environment gets an isolated Terraform state file stored in S3: `terraform/state/<env>/<mode>.tfstate`. The S3 bucket is auto-created by `bin/tf` if it does not exist.

## Prerequisites

- Terraform >= 1.11.0
- AWS CLI configured
- Docker (for local Compose workflows)
- kubectl (for k8s mode)
- helm (for k8s mode)

Required providers (managed automatically by `terraform init`):

| Provider   | Version |
| ---------- | ------- |
| aws        | ~> 5.95 |
| helm       | ~> 3.1  |
| kubernetes | ~> 3.0  |
| random     | ~> 3.8  |

## Secrets Management

Secrets are stored in `.env.<environment>` files (gitignored). Copy `.env.example` to get started:

```bash
cp .env.example .env.dev
```

Required variables:

```bash
# AWS credentials
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1

# Project identity
TF_VAR_project=my-project
TF_VAR_deployment_mode=compose          # or k8s

# Feature toggles
TF_VAR_enable_keycloak=true
TF_VAR_cicd_enabled=true

# Network access (replace YOUR_IP)
TF_VAR_public_access_cidrs='["x.x.x.x/32"]'
TF_VAR_db_public_access_cidrs='["x.x.x.x/32"]'

# Sensitive credentials
TF_VAR_keycloak_client_secret=...
TF_VAR_db_reader_password=...
TF_VAR_backend_db_password=...
```

The `bin/tf` script validates that placeholder values (`YOUR_IP`, `<your-access-key-id>`) have been replaced before running any Terraform command.

## The `bin/tf` Script

Central CLI wrapper that handles environment loading, backend initialization, and Terraform execution.

```bash
./bin/tf <command> <environment>
```

| Command   | Description                                                          |
| --------- | -------------------------------------------------------------------- |
| `plan`    | `terraform init` + `plan`, saves plan to `environments/<env>.tfplan` |
| `apply`   | `terraform init` + `apply -auto-approve`                             |
| `destroy` | `terraform init` + `destroy -auto-approve`                           |
| `output`  | Show Terraform outputs for the given state                           |
| `exec`    | Pass-through: init + any arbitrary terraform subcommand              |

Convenience wrappers (`bin/plan`, `bin/apply`, `bin/destroy`, `bin/output`) delegate to `bin/tf`.

Pre-flight checks performed by `bin/tf`:

- Terraform >= 1.11.0 version check
- AWS credentials validation via `aws sts get-caller-identity`
- S3 backend bucket auto-creation if missing
- Input validation (placeholder detection, missing tfvars)

The S3 backend key includes the deployment mode: `terraform/state/<env>/<mode>.tfstate`, so k8s and compose states for the same environment are stored separately.

## CI/CD

AWS CodePipeline triggers on branch pushes to CodeCommit. Separate pipelines exist for backend, frontend, and infrastructure, defined in `infra/cicd/`.

### Buildspec files

| File                     | Trigger folder | Description                                                                   |
| ------------------------ | -------------- | ----------------------------------------------------------------------------- |
| `buildspec.backend.yml`  | `fastapi/`     | Build backend Docker image, push to ECR, deploy                               |
| `buildspec.frontend.yml` | `frontend/`    | Build frontend Docker image, push to ECR, deploy                              |
| `buildspec.infra.yml`    | `infra/`       | Run `terraform fmt`, tflint, tfsec, validate, plan, and auto-apply (dev only) |

### Change-aware builds

All three buildspec files implement change detection:

1. The last deployed commit SHA is stored in an SSM Parameter.
2. On each build, `aws codecommit get-differences` compares the current commit against the last deployed one.
3. If no files changed under the relevant folder (`fastapi/`, `frontend/`, or `infra/`), the build and deploy phases are skipped entirely.
4. After a successful deploy, the SSM parameter is updated with the new commit SHA.

### Deploy strategies

The backend and frontend buildspecs support both deployment modes:

- **k8s mode:** Updates the Kubernetes Deployment image via `kubectl set image` and waits for rollout.
- **compose mode:** Sends an SSM RunCommand to the EC2 instance to pull the new image from ECR and restart the service via `docker-compose up -d --no-deps`.

The infra buildspec runs `terraform plan` with `-detailed-exitcode`. For dev, changes are auto-applied. For staging and prod, the plan is displayed but must be applied manually via `bin/apply`.

### Branch-to-environment mapping

| Branch    | Environment |
| --------- | ----------- |
| `develop` | `dev`       |
| `staging` | `staging`   |
| `main`    | `prod`      |

Branch names are configurable via `cicd_dev_branch`, `cicd_staging_branch`, and `cicd_prod_branch` variables.

## Monitoring

The `monitoring.tf` file provisions CloudWatch resources for both deployment modes:

**Alarms (all environments):**

- RDS CPU utilization > 80% (15 min sustained)
- RDS database connections above threshold (80 for prod, 40 for non-prod)
- RDS free storage below 5 GB
- RDS read/write latency above 20ms (15 min sustained)

**Alarms (compose mode only):**

- EC2 instance status check failures
- Backend 5xx error rate (log-based metric, >10 errors in 5 min)

All alarms publish to an SNS topic (`<prefix>-alerts`). Subscribe an email address or Slack webhook to receive notifications.

A CloudWatch dashboard (`<prefix>-overview`) is created with widgets for RDS metrics, plus EKS node CPU/memory (k8s mode) or EC2 CPU (compose mode).

## Security Notes

The infrastructure enforces several security constraints at the Terraform variable validation level:

**EKS API access:**

- `public_access_cidrs` must not contain `0.0.0.0/0`. The EKS API endpoint is always restricted to specific CIDRs.
- For production k8s deployments, `public_access_cidrs` is required (cannot be empty).
- When CI/CD is enabled, CodeBuild public IP ranges for the CI/CD region are automatically added to the EKS API allow list.

**CORS:**

- `backend_cors_allow_origins` must not be `*` in production. Set explicit origin URLs.

**Database access:**

- `db_public_access_cidrs` must not contain `0.0.0.0/0`. Direct DB access is restricted to specific developer IPs.
- RDS is placed in isolated database subnets by default. Public access requires `db_publicly_accessible=true` in tfvars.
- Master DB password is auto-generated (24 characters) and stored in Secrets Manager.
- Deletion protection is enabled for production RDS instances.

**SSH access (compose mode):**

- `compose_ssh_allowed_cidr` must not be `0.0.0.0/0`. Leave empty to disable SSH ingress entirely.

**Encryption and logging:**

- RDS storage is encrypted (`storage_encrypted = true`).
- S3 artifact buckets use server-side encryption (AES-256).
- ECR image scanning is enabled on push.
- EKS control plane logging is enabled for all log types (api, audit, authenticator, controllerManager, scheduler).
- RDS enhanced monitoring (60s interval) and Performance Insights are enabled.
- RDS PostgreSQL and upgrade logs are exported to CloudWatch.

## Database Migrations

The `fastapi/migrate.py` script wraps Alembic and is used in both Docker Compose and CI/CD:

```bash
# Upgrade to latest (default)
uv run migrate.py

# Target a specific revision
uv run migrate.py --revision abc123

# Downgrade
uv run migrate.py --downgrade -1
```

Requires `SQLALCHEMY_DATABASE_URI` in the environment. In production Compose, this comes from `fastapi/.env`. In the dev Compose, it is set inline pointing to the local Postgres container.

## Post-Deploy Verification

```bash
# Check Terraform outputs
./bin/tf output dev

# For k8s mode
aws eks update-kubeconfig --name <cluster_name> --region <region>
kubectl get pods -n apps
kubectl get svc -n apps

# For compose mode
ssh ec2-user@<instance-ip>
docker compose ps
curl -k https://<instance-ip>/api/health
```

## Cleanup

```bash
./bin/tf destroy dev
```
