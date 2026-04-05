# ── Identity ──────────────────────────────────────────────────────────────────
# project, aws_region, deployment_mode, enable_keycloak, cicd_enabled, and
# access CIDRs all come from .env.dev via TF_VAR_* — not set here.
environment = "dev"

# ── EKS topology (k8s mode) ───────────────────────────────────────────────────
kubernetes_version  = "1.32"
node_instance_types = ["t3.medium"]
node_desired_size   = 2
node_min_size       = 1
node_max_size       = 3

# ── Database topology ─────────────────────────────────────────────────────────
db_instance_class        = "db.t4g.micro"
db_multi_az              = false
db_backup_retention_days = 7
db_publicly_accessible   = true     # requires TF_VAR_db_public_access_cidrs set to your IP (0.0.0.0/0 is rejected)

# ── Compose topology ──────────────────────────────────────────────────────────
# t3.medium (4 GB): sufficient for Keycloak (~2 GB JVM) + backend + frontend + nginx
compose_instance_type = "t3.medium"

# ── Keycloak behavior ─────────────────────────────────────────────────────────
keycloak_remember_me                  = true
keycloak_direct_access_grants_enabled = true
keycloak_realm_file_name              = "dev-realm.json"
keycloak_users_json_file_path         = "../environments/keycloak/dev-users.json"
