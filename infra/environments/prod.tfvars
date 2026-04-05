# ── Identity ──────────────────────────────────────────────────────────────────
# project, aws_region, deployment_mode, enable_keycloak, cicd_enabled, and
# access CIDRs all come from .env.prod via TF_VAR_* — not set here.
environment = "prod"

# ── EKS topology (k8s mode) ───────────────────────────────────────────────────
kubernetes_version  = "1.32"
node_instance_types = ["t3.large"]
node_desired_size   = 3
node_min_size       = 2
node_max_size       = 6

# ── Database topology ─────────────────────────────────────────────────────────
db_instance_class        = "db.t4g.small"
db_multi_az              = true
db_backup_retention_days = 30
db_publicly_accessible   = false
db_public_access_cidrs   = []

# ── Compose topology ──────────────────────────────────────────────────────────
# t3.large (8 GB): headroom for Keycloak + backend + frontend under prod load
compose_instance_type = "t3.large"

# ── Keycloak behavior ─────────────────────────────────────────────────────────
keycloak_remember_me                  = false
keycloak_direct_access_grants_enabled = false
keycloak_realm_file_name              = "prod-realm.json"
keycloak_users_json_file_path         = "../environments/keycloak/empty-users.json"
