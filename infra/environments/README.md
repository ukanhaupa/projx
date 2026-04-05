# Environment Configs

## tfvars files — topology only

Each file controls infrastructure sizing and behaviour for that environment.
Secrets, credentials, project name, and AWS region come from `.env.<env>` — never put them here.

| File | Purpose |
|------|---------|
| `dev.tfvars` | Dev overrides — small instances, public DB, Keycloak direct grants on |
| `staging.tfvars` | Staging overrides — prod-like restrictions, smaller instances |
| `prod.tfvars` | Prod overrides — large instances, multi-AZ, no public access |

## Keycloak config files

| File | Purpose |
|------|---------|
| `keycloak/realm.template.json.tftpl` | Single realm template rendered by Terraform at apply time. Customize roles, clients, and mappers here for your project. |
| `keycloak/groups.common.json` | Group → role mappings shared across all environments. |
| `keycloak/dev-users.json` | Seed users auto-imported in dev. Passwords are temporary — change on first login. |
| `keycloak/empty-users.json` | Empty user list for staging and prod (no seed users). |

> `keycloak_realm_file_name` in tfvars (e.g. `"dev-realm.json"`) is a ConfigMap key name only —
> there is no corresponding file on disk. Content is always rendered from `realm.template.json.tftpl`.

## How to apply

Use the `bin/tf` wrapper from the repo root — it loads `.env.<env>`, generates the S3 backend
config, and runs Terraform:

```sh
./bin/plan   dev        # preview
./bin/apply  dev        # apply

./bin/plan   staging
./bin/apply  staging

./bin/plan   prod
./bin/apply  prod
```

See `stack/README.md` for full details on variable sources and state layout.
