# This module orchestrates which deployment mode is active.
# It does not create any resources by itself, but it instantiates either the
# `k8s` module (EKS + Kubernetes workloads) or the `compose` module (EC2 + Docker
# Compose) based on `var.deployment_mode`.

module "k8s" {
  source = "./k8s"
  count  = local.use_k8s ? 1 : 0

  aws_region         = var.aws_region
  environment        = var.environment
  project            = var.project
  name_prefix        = local.name_prefix
  tags               = local.tags
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnets

  cicd_enabled                        = var.cicd_enabled
  allow_cicd_codebuild_eks_api_access = var.allow_cicd_codebuild_eks_api_access
  cicd_region                         = local.cicd_region_effective
  public_access_cidrs                 = var.public_access_cidrs
  kubernetes_version                  = var.kubernetes_version
  node_instance_types                 = var.node_instance_types
  node_desired_size                   = var.node_desired_size
  node_min_size                       = var.node_min_size
  node_max_size                       = var.node_max_size

  apps_namespace      = var.apps_namespace
  backend_db_name     = local.backend_db_name_effective
  backend_db_username = var.backend_db_username
  backend_db_password = var.backend_db_password

  db_host            = aws_db_instance.shared.address
  db_port            = aws_db_instance.shared.port
  db_master_user     = var.db_username
  db_master_password = random_password.db_password.result
  db_master_database = var.db_name
  db_reader_username = var.db_reader_username
  db_reader_password = var.db_reader_password

  keycloak_db_name     = var.keycloak_db_name
  keycloak_db_username = var.keycloak_db_username

  ecr_backend_repository_url  = var.cicd_enabled ? aws_ecr_repository.backend[0].repository_url : ""
  ecr_frontend_repository_url = var.cicd_enabled ? aws_ecr_repository.frontend[0].repository_url : ""
  backend_image               = var.backend_image
  frontend_image              = var.frontend_image
  backend_port                = var.backend_port
  backend_replicas            = var.backend_replicas
  frontend_replicas           = var.frontend_replicas
  backend_cors_allow_origins  = var.backend_cors_allow_origins
  backend_jwt_provider        = var.backend_jwt_provider
  backend_jwt_algorithms      = var.backend_jwt_algorithms
  backend_jwt_jwks_url        = var.backend_jwt_jwks_url
  backend_jwt_issuer          = var.backend_jwt_issuer
  backend_jwt_audience        = var.backend_jwt_audience

  enable_keycloak                       = var.enable_keycloak
  keycloak_realm_name                   = local.keycloak_realm_name_effective
  keycloak_realm_display_name           = local.keycloak_realm_display_name_effective
  keycloak_remember_me                  = var.keycloak_remember_me
  keycloak_client_id                    = local.keycloak_client_id_effective
  keycloak_client_name                  = local.keycloak_client_name_effective
  keycloak_client_secret                = var.keycloak_client_secret
  keycloak_direct_access_grants_enabled = var.keycloak_direct_access_grants_enabled
  keycloak_groups_json                  = var.keycloak_groups_json
  keycloak_users_json                   = var.keycloak_users_json
  keycloak_groups_json_file_path        = var.keycloak_groups_json_file_path
  keycloak_users_json_file_path         = var.keycloak_users_json_file_path
  keycloak_realm_template_path          = var.keycloak_realm_template_path
  eks_cluster_name                      = try(module.eks[0].cluster_name, "")
  eks_oidc_provider                     = try(module.eks[0].oidc_provider, "")
  eks_oidc_provider_arn                 = try(module.eks[0].oidc_provider_arn, "")

  keycloak_realm_file_name = var.keycloak_realm_file_name
  enable_realm_bootstrap   = var.enable_realm_bootstrap
  keycloak_chart_version   = var.keycloak_chart_version
}

module "compose" {
  source = "./compose"
  count  = local.use_compose ? 1 : 0

  aws_region  = var.aws_region
  environment = var.environment
  project     = var.project
  name_prefix = local.name_prefix
  tags        = local.tags
  vpc_id      = module.vpc.vpc_id
  subnet_ids  = module.vpc.public_subnets

  instance_type    = var.compose_instance_type
  ssh_key_name     = var.compose_ssh_key_name
  allowed_ssh_cidr = var.compose_ssh_allowed_cidr

  enable_keycloak = var.enable_keycloak

  keycloak_realm_name                   = local.keycloak_realm_name_effective
  keycloak_realm_display_name           = local.keycloak_realm_display_name_effective
  keycloak_remember_me                  = var.keycloak_remember_me
  keycloak_client_id                    = local.keycloak_client_id_effective
  keycloak_client_name                  = local.keycloak_client_name_effective
  keycloak_client_secret                = var.keycloak_client_secret
  keycloak_direct_access_grants_enabled = var.keycloak_direct_access_grants_enabled
  keycloak_groups_json                  = var.keycloak_groups_json
  keycloak_users_json                   = var.keycloak_users_json
  keycloak_groups_json_file_path        = var.keycloak_groups_json_file_path
  keycloak_users_json_file_path         = var.keycloak_users_json_file_path
  keycloak_realm_template_path          = var.keycloak_realm_template_path

  db_host            = aws_db_instance.shared.address
  db_port            = aws_db_instance.shared.port
  db_master_user     = var.db_username
  db_master_password = random_password.db_password.result

  backend_db_name     = local.backend_db_name_effective
  backend_db_username = var.backend_db_username
  backend_db_password = var.backend_db_password

  keycloak_db_name     = var.keycloak_db_name
  keycloak_db_username = var.keycloak_db_username

  db_reader_username = var.db_reader_username
  db_reader_password = var.db_reader_password

  backend_port   = var.backend_port
  backend_image  = var.backend_image
  frontend_image = var.frontend_image

  ecr_backend_repository_url  = var.cicd_enabled ? aws_ecr_repository.backend[0].repository_url : ""
  ecr_frontend_repository_url = var.cicd_enabled ? aws_ecr_repository.frontend[0].repository_url : ""
}
