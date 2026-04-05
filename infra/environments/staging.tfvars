# ── Identity ──────────────────────────────────────────────────────────────────
# project, aws_region, deployment_mode, enable_keycloak, cicd_enabled, and
# access CIDRs all come from .env.staging via TF_VAR_* — not set here.
environment = "staging"

# ── EKS topology (k8s mode) — scaled-down prod ───────────────────────────────
kubernetes_version  = "1.32"
node_instance_types = ["t3.medium"]
node_desired_size   = 2
node_min_size       = 1
node_max_size       = 3

# ── Database topology — prod-like restrictions, smaller instance ──────────────
db_instance_class        = "db.t4g.micro"
db_multi_az              = false
db_backup_retention_days = 7
db_publicly_accessible   = false    # restricted like prod
db_public_access_cidrs   = []

# ── Compose topology ──────────────────────────────────────────────────────────
# t3.medium (4 GB): same sizing as dev; upgrade to t3.large if load testing
compose_instance_type = "t3.medium"

# ── Keycloak behavior — prod-like (no dev shortcuts) ─────────────────────────
keycloak_remember_me                  = false
keycloak_direct_access_grants_enabled = false
keycloak_realm_file_name              = "staging-realm.json"
keycloak_users_json_file_path         = "../environments/keycloak/empty-users.json"
