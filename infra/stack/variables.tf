variable "aws_region" {
  description = "AWS deployment region."
  type        = string
}

variable "environment" {
  description = "Environment name."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of 'dev', 'staging', or 'prod'."
  }
}

variable "deployment_mode" {
  description = "Deployment mode. Set to 'compose' for EC2 + Docker Compose, or 'k8s' for EKS + Kubernetes."
  type        = string
  default     = "compose"

  validation {
    condition     = contains(["compose", "k8s"], var.deployment_mode)
    error_message = "deployment_mode must be either 'compose' or 'k8s'."
  }
}

variable "project" {
  description = "Project/application name prefix. Must be set (no default)."
  type        = string

  validation {
    condition     = trimspace(var.project) != ""
    error_message = "project must be set (e.g., via TF_VAR_project in .env)."
  }
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.50.0.0/16"
}

variable "public_access_cidrs" {
  description = "CIDRs allowed to access the EKS public API endpoint. Required for production."
  type        = list(string)
  default     = []

  validation {
    condition     = !(var.environment == "prod" && var.deployment_mode == "k8s" && length(var.public_access_cidrs) == 0)
    error_message = "public_access_cidrs must be set for production EKS deployments. Restrict API access to known CIDRs."
  }

  validation {
    condition     = !contains(var.public_access_cidrs, "0.0.0.0/0")
    error_message = "public_access_cidrs must not contain 0.0.0.0/0. Restrict EKS API access to specific CIDRs."
  }
}

variable "kubernetes_version" {
  description = "Kubernetes version for EKS."
  type        = string
  default     = "1.32"
}

variable "node_instance_types" {
  description = "EKS managed node instance types."
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_desired_size" {
  description = "Desired node count."
  type        = number
  default     = 2
}

variable "node_min_size" {
  description = "Minimum node count."
  type        = number
  default     = 1
}

variable "node_max_size" {
  description = "Maximum node count."
  type        = number
  default     = 3
}

variable "db_instance_class" {
  description = "RDS instance class for shared backend database."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Initial allocated storage for RDS in GiB."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Max autoscaled RDS storage in GiB."
  type        = number
  default     = 100
}

variable "db_name" {
  description = "Initial shared database name created with the DB instance."
  type        = string
  default     = "postgres"
}

variable "db_username" {
  description = "Master database username."
  type        = string
  default     = "postgres"
}

variable "keycloak_db_name" {
  description = "Dedicated Keycloak database name created inside shared RDS instance."
  type        = string
  default     = "keycloak"
}

variable "keycloak_db_username" {
  description = "Dedicated Keycloak database user created inside shared RDS instance."
  type        = string
  default     = "keycloak_user"
}

variable "db_reader_username" {
  description = "Dedicated shared read-only user for direct DB access to backend database."
  type        = string
  default     = "db_reader"
}

variable "db_reader_password" {
  description = "Password for shared read-only DB user (set via TF_VAR_db_reader_password)."
  type        = string
  sensitive   = true
  default     = ""

  validation {
    condition     = trimspace(var.db_reader_password) != ""
    error_message = "db_reader_password must be set (use TF_VAR_db_reader_password in infra/.env)."
  }
}

variable "backend_db_name" {
  description = "Application database name for backend service. Defaults to project name (underscored). Created if missing."
  type        = string
  default     = ""
}

variable "backend_db_username" {
  description = "Dedicated backend application DB username."
  type        = string
  default     = "backend_app"
}

variable "backend_db_password" {
  description = "Password for backend application DB user (set via TF_VAR_backend_db_password)."
  type        = string
  sensitive   = true
  default     = ""

  validation {
    condition     = trimspace(var.backend_db_password) != ""
    error_message = "backend_db_password must be set (use TF_VAR_backend_db_password in infra/.env)."
  }
}

variable "apps_namespace" {
  description = "Kubernetes namespace for backend/frontend workloads."
  type        = string
  default     = "apps"
}

variable "backend_image" {
  description = "Container image for backend deployment. When empty, this defaults to the ECR repository created by CI/CD."
  type        = string
  default     = ""
}

variable "frontend_image" {
  description = "Container image for frontend deployment. When empty, this defaults to the ECR repository created by CI/CD."
  type        = string
  default     = ""
}

variable "backend_port" {
  description = "Port the backend container listens on."
  type        = number
  default     = 7860
}

variable "backend_replicas" {
  description = "Replica count for backend deployment."
  type        = number
  default     = 1
}

variable "frontend_replicas" {
  description = "Replica count for frontend deployment."
  type        = number
  default     = 1
}

variable "backend_cors_allow_origins" {
  description = "CORS origins for backend. Must not be '*' in production."
  type        = string
  default     = ""

  validation {
    condition     = !(var.environment == "prod" && var.backend_cors_allow_origins == "*")
    error_message = "backend_cors_allow_origins must not be '*' in production. Set explicit origins."
  }
}

variable "backend_jwt_provider" {
  description = "JWT provider mode for backend auth config."
  type        = string
  default     = "jwks"
}

variable "backend_jwt_algorithms" {
  description = "JWT algorithm allow-list for backend auth config."
  type        = string
  default     = "RS256"
}

variable "backend_jwt_jwks_url" {
  description = "JWKS URL for backend JWT verification."
  type        = string
  default     = ""
}

variable "backend_jwt_issuer" {
  description = "JWT issuer for backend token validation."
  type        = string
  default     = ""
}

variable "backend_jwt_audience" {
  description = "Optional JWT audience for backend token validation."
  type        = string
  default     = ""
}

variable "db_multi_az" {
  description = "Enable Multi-AZ for RDS."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "Backup retention period for RDS."
  type        = number
  default     = 7
}

variable "db_publicly_accessible" {
  description = "Whether RDS should be publicly accessible. Keep false for production."
  type        = bool
  default     = false
}

variable "db_public_access_cidrs" {
  description = "CIDRs allowed to reach PostgreSQL directly when db_publicly_accessible is true. Must not contain 0.0.0.0/0."
  type        = list(string)
  default     = []

  validation {
    condition     = !contains(var.db_public_access_cidrs, "0.0.0.0/0")
    error_message = "db_public_access_cidrs must not contain 0.0.0.0/0. Restrict direct DB access to specific developer IPs."
  }
}

variable "keycloak_chart_version" {
  description = "Bitnami Keycloak Helm chart version."
  type        = string
  default     = "24.9.0"
}

variable "enable_keycloak" {
  description = "Deploy Keycloak identity provider. Set to false to skip Keycloak entirely."
  type        = bool
  default     = true
}

variable "enable_realm_bootstrap" {
  description = "Enable Keycloak realm bootstrap import using keycloak-config-cli."
  type        = bool
  default     = true
}

variable "keycloak_realm_file_name" {
  description = "File name used by Keycloak config import for realm JSON."
  type        = string
  default     = "realm.json"
}

variable "keycloak_realm_template_path" {
  description = "Path to the Keycloak realm template file (JSON tftpl)."
  type        = string
  default     = "../environments/keycloak/realm.template.json.tftpl"
}

variable "keycloak_realm_name" {
  description = "Realm name to provision/import in Keycloak. Defaults to '<project>-<environment>'."
  type        = string
  default     = ""
}

variable "keycloak_realm_display_name" {
  description = "Realm display name shown in Keycloak UI. Defaults to '<project> <environment>'."
  type        = string
  default     = ""
}

variable "keycloak_remember_me" {
  description = "Enable remember-me at realm login screen."
  type        = bool
  default     = true
}

variable "keycloak_client_id" {
  description = "OIDC client ID used by backend API. Defaults to '<project>-backend'."
  type        = string
  default     = ""
}

variable "keycloak_client_name" {
  description = "OIDC client display name used by backend API. Defaults to '<project> Backend API'."
  type        = string
  default     = ""
}

variable "keycloak_client_secret" {
  description = "OIDC client secret for backend API client."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition = !(
      var.environment == "prod" &&
      var.enable_keycloak &&
      trimspace(var.keycloak_client_secret) == ""
    )
    error_message = "For prod with enable_keycloak=true, keycloak_client_secret must be provided (use TF_VAR_keycloak_client_secret in .env.prod)."
  }
}

variable "keycloak_direct_access_grants_enabled" {
  description = "Enable direct access grants for backend client (typically true in dev only)."
  type        = bool
  default     = false
}

variable "keycloak_groups_json" {
  description = "Raw JSON array string defining Keycloak groups for realm import. If empty, keycloak_groups_json_file_path is used."
  type        = string
  default     = ""
}

variable "keycloak_users_json" {
  description = "Raw JSON array string defining Keycloak users for realm import. If empty, keycloak_users_json_file_path is used."
  type        = string
  default     = ""
}

variable "keycloak_groups_json_file_path" {
  description = "Path to JSON file defining Keycloak groups for realm import (used when keycloak_groups_json is empty)."
  type        = string
  default     = "../environments/keycloak/groups.common.json"
}

variable "keycloak_users_json_file_path" {
  description = "Path to JSON file defining Keycloak users for realm import (used when keycloak_users_json is empty)."
  type        = string
  default     = "../environments/keycloak/empty-users.json"
}

variable "cicd_enabled" {
  description = "Enable CI/CD resources (CodePipeline + CodeBuild + ECR) for app deployments."
  type        = bool
  default     = true
}

variable "cicd_region" {
  description = "AWS region where CodeCommit/CodeBuild/CodePipeline resources are provisioned."
  type        = string
  default     = ""
}

variable "cicd_codecommit_repository_name" {
  description = "CodeCommit repository name. Defaults to the project name."
  type        = string
  default     = ""
}

variable "cicd_dev_branch" {
  description = "Branch used for development deployments."
  type        = string
  default     = "develop"
}

variable "cicd_staging_branch" {
  description = "Branch used for staging deployments."
  type        = string
  default     = "staging"
}

variable "cicd_prod_branch" {
  description = "Branch used for production deployments."
  type        = string
  default     = "main"
}

variable "allow_cicd_codebuild_eks_api_access" {
  description = "Allow EKS API access from AWS CodeBuild public CIDR ranges in cicd_region."
  type        = bool
  default     = true
}

variable "cicd_ecr_keep_image_count" {
  description = "Number of recent images to keep in each ECR repository."
  type        = number
  default     = 50
}

variable "compose_instance_type" {
  description = "EC2 instance type for the compose host (all services: backend + frontend + keycloak + nginx). Use t3.medium or larger when enable_keycloak=true."
  type        = string
  default     = "t3.medium"
}

variable "compose_ssh_key_name" {
  description = "EC2 key pair name for compose deployment SSH access."
  type        = string
  default     = ""
}

variable "compose_ssh_allowed_cidr" {
  description = "CIDR range allowed to SSH into the compose deployment hosts. Must be a specific CIDR — 0.0.0.0/0 is rejected."
  type        = string
  default     = ""

  validation {
    condition     = var.compose_ssh_allowed_cidr != "0.0.0.0/0"
    error_message = "compose_ssh_allowed_cidr must not be 0.0.0.0/0. Restrict SSH access to a specific IP or CIDR range, or leave empty to disable SSH ingress."
  }
}
