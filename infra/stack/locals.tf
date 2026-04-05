data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name_prefix = "${var.project}-${var.environment}-${replace(var.aws_region, "-", "")}"

  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  tags = {
    Environment = var.environment
    Project     = var.project
  }

  # ── Derived effective values (fall back to project-based defaults) ───────────

  backend_db_name_effective = var.backend_db_name != "" ? var.backend_db_name : replace(var.project, "-", "_")

  keycloak_realm_name_effective         = var.keycloak_realm_name != "" ? var.keycloak_realm_name : "${var.project}-${var.environment}"
  keycloak_realm_display_name_effective = var.keycloak_realm_display_name != "" ? var.keycloak_realm_display_name : "${var.project} ${var.environment}"
  keycloak_client_id_effective          = var.keycloak_client_id != "" ? var.keycloak_client_id : "${var.project}-backend"
  keycloak_client_name_effective        = var.keycloak_client_name != "" ? var.keycloak_client_name : "${var.project} Backend API"

  codecommit_repo_name_effective = var.cicd_codecommit_repository_name != "" ? var.cicd_codecommit_repository_name : var.project
  cicd_region_effective          = var.cicd_region != "" ? var.cicd_region : var.aws_region

  cicd_branch = (
    var.environment == "prod" ? var.cicd_prod_branch :
    var.environment == "staging" ? var.cicd_staging_branch :
    var.cicd_dev_branch
  )

  cicd_name_prefix = "${local.name_prefix}-cicd"

  use_k8s     = var.deployment_mode == "k8s"
  use_compose = var.deployment_mode == "compose"
}
