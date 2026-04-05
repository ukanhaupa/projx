variable "aws_region" {
  description = "AWS region used for naming and provider configuration."
  type        = string
}

variable "name_prefix" {
  description = "Pre-computed name prefix (project-environment-region)."
  type        = string
}

variable "tags" {
  description = "Common resource tags."
  type        = map(string)
  default     = {}
}

variable "environment" {
  description = "Environment name (dev/staging/prod)."
  type        = string
}

variable "project" {
  description = "Project/application name prefix."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where EKS cluster and related resources will be deployed."
  type        = string
}

variable "private_subnet_ids" {
  description = "Subnet IDs for EKS worker nodes."
  type        = list(string)
}

variable "eks_cluster_name" {
  description = "EKS cluster name (for label/annotation usage)."
  type        = string
}

variable "eks_oidc_provider" {
  description = "EKS OIDC provider URL without https:// (used in IAM condition variables)."
  type        = string
}

variable "eks_oidc_provider_arn" {
  description = "EKS IAM OIDC provider ARN for IRSA role trust."
  type        = string
}

variable "cicd_enabled" {
  description = "Whether CI/CD (ECR/repos) is enabled."
  type        = bool
}

variable "allow_cicd_codebuild_eks_api_access" {
  description = "Whether to allow CodeBuild IPs to access the EKS API endpoint."
  type        = bool
}

variable "cicd_region" {
  description = "Region used for CodeBuild; used only for obtaining IP ranges."
  type        = string
}

variable "public_access_cidrs" {
  description = "CIDRs allowed to access the EKS API endpoint."
  type        = list(string)
}

variable "kubernetes_version" {
  description = "Kubernetes version to use for the EKS cluster."
  type        = string
}

variable "node_instance_types" {
  description = "EKS node instance types."
  type        = list(string)
}

variable "node_desired_size" {
  description = "Desired number of EKS worker nodes."
  type        = number
}

variable "node_min_size" {
  description = "Minimum number of EKS worker nodes."
  type        = number
}

variable "node_max_size" {
  description = "Maximum number of EKS worker nodes."
  type        = number
}

variable "apps_namespace" {
  description = "Kubernetes namespace for application workloads."
  type        = string
}

variable "backend_db_name" {
  description = "Database name for the backend service."
  type        = string
}

variable "backend_db_username" {
  description = "Database username for the backend service."
  type        = string
}

variable "backend_db_password" {
  description = "Database password for the backend service."
  type        = string
}

variable "db_host" {
  description = "Hostname for the PostgreSQL database used by the cluster."
  type        = string
}

variable "db_port" {
  description = "Port for the PostgreSQL database used by the cluster."
  type        = number
}

variable "db_master_user" {
  description = "Master DB user for bootstrapping additional users and databases."
  type        = string
}

variable "db_master_password" {
  description = "Master DB password for bootstrapping additional users and databases."
  type        = string
}

variable "db_master_database" {
  description = "Master DB name (the database the master user initially connects to)."
  type        = string
}

variable "db_reader_username" {
  description = "Read-only DB user name."
  type        = string
}

variable "db_reader_password" {
  description = "Read-only DB user password."
  type        = string
}

variable "keycloak_db_name" {
  description = "Keycloak-specific database name."
  type        = string
}

variable "keycloak_db_username" {
  description = "Keycloak database user name."
  type        = string
}

variable "ecr_backend_repository_url" {
  description = "ECR repository URL for the backend service."
  type        = string
}

variable "ecr_frontend_repository_url" {
  description = "ECR repository URL for the frontend service."
  type        = string
}

variable "backend_image" {
  description = "Explicit backend image override (optional)."
  type        = string
  default     = ""
}

variable "frontend_image" {
  description = "Explicit frontend image override (optional)."
  type        = string
  default     = ""
}

variable "backend_port" {
  description = "Port the backend container listens on."
  type        = number
  default     = 7860
}

variable "backend_replicas" {
  description = "Replica count for the backend deployment."
  type        = number
}

variable "frontend_replicas" {
  description = "Replica count for the frontend deployment."
  type        = number
}

variable "backend_cors_allow_origins" {
  description = "CORS allow origins for the backend service."
  type        = string
}

variable "backend_jwt_provider" {
  description = "JWT provider mode for backend auth config."
  type        = string
}

variable "backend_jwt_algorithms" {
  description = "JWT algorithms allow-list for backend auth config."
  type        = string
}

variable "backend_jwt_jwks_url" {
  description = "JWKS URL for backend JWT verification."
  type        = string
}

variable "backend_jwt_issuer" {
  description = "JWT issuer for backend token validation."
  type        = string
}

variable "backend_jwt_audience" {
  description = "Optional JWT audience for backend token validation."
  type        = string
}

variable "keycloak_realm_name" {
  description = "Keycloak realm name."
  type        = string
}

variable "keycloak_realm_display_name" {
  description = "Keycloak realm display name."
  type        = string
}

variable "keycloak_remember_me" {
  description = "Whether Keycloak should show the remember-me checkbox."
  type        = bool
}

variable "keycloak_client_id" {
  description = "Keycloak client ID."
  type        = string
}

variable "keycloak_client_name" {
  description = "Keycloak client name."
  type        = string
}

variable "keycloak_client_secret" {
  description = "Keycloak client secret."
  type        = string
}

variable "keycloak_direct_access_grants_enabled" {
  description = "Whether Keycloak direct access grants are enabled."
  type        = bool
}

variable "keycloak_groups_json" {
  description = "JSON array of Keycloak groups (optional)."
  type        = string
  default     = ""
}

variable "keycloak_users_json" {
  description = "JSON array of Keycloak users (optional)."
  type        = string
  default     = ""
}

variable "keycloak_groups_json_file_path" {
  description = "Path to Keycloak groups JSON file (optional)."
  type        = string
  default     = ""
}

variable "keycloak_users_json_file_path" {
  description = "Path to Keycloak users JSON file (optional)."
  type        = string
  default     = ""
}

variable "keycloak_realm_template_path" {
  description = "Path to the Keycloak realm template file."
  type        = string
}

variable "keycloak_realm_file_name" {
  description = "Filename key for the Keycloak realm JSON when uploaded as a config map."
  type        = string
}

variable "enable_keycloak" {
  description = "Deploy Keycloak identity provider."
  type        = bool
  default     = true
}

variable "enable_realm_bootstrap" {
  description = "Enable Keycloak realm bootstrap via keycloak-config-cli."
  type        = bool
}

variable "keycloak_chart_version" {
  description = "Bitnami Keycloak Helm chart version."
  type        = string
}
