variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
}

variable "environment" {
  description = "Environment name (dev/staging/prod)."
  type        = string
}

variable "project" {
  description = "Project name prefix."
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

variable "vpc_id" {
  description = "VPC ID where the EC2 instance should be launched."
  type        = string
}

variable "subnet_ids" {
  description = "List of public subnet IDs for EC2 placement."
  type        = list(string)
}

variable "instance_type" {
  description = "EC2 instance type. Should be t3.medium or larger when enable_keycloak=true (Keycloak needs ~1 GB JVM + app services)."
  type        = string
  default     = "t3.medium"
}

variable "ssh_key_name" {
  description = "Name of an existing AWS EC2 key pair for SSH access."
  type        = string
  default     = ""
}

variable "allowed_ssh_cidr" {
  description = "CIDR range allowed to SSH into the instance. Empty string disables SSH ingress."
  type        = string
  default     = ""
}

variable "enable_keycloak" {
  description = "Include Keycloak in the Docker Compose stack on this instance."
  type        = bool
  default     = true
}

# ── Database ──────────────────────────────────────────────────────────────────

variable "db_host" {
  description = "RDS endpoint hostname."
  type        = string
}

variable "db_port" {
  description = "RDS port."
  type        = number
  default     = 5432
}

variable "db_master_user" {
  description = "RDS master username."
  type        = string
}

variable "db_master_password" {
  description = "RDS master password."
  type        = string
  sensitive   = true
}

variable "backend_db_name" {
  description = "Backend application database name."
  type        = string
}

variable "backend_db_username" {
  description = "Backend application database username."
  type        = string
}

variable "backend_db_password" {
  description = "Backend application database password."
  type        = string
  sensitive   = true
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
  sensitive   = true
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

variable "keycloak_db_name" {
  description = "Keycloak database name."
  type        = string
  default     = "keycloak"
}

variable "keycloak_db_username" {
  description = "Keycloak database username."
  type        = string
  default     = "keycloak_user"
}

variable "db_reader_username" {
  description = "Shared read-only DB username."
  type        = string
}

variable "db_reader_password" {
  description = "Shared read-only DB user password."
  type        = string
  sensitive   = true
}

# ── Application images ────────────────────────────────────────────────────────

variable "backend_port" {
  description = "Port the backend container listens on."
  type        = number
  default     = 7860
}

variable "backend_image" {
  description = "Docker image for the backend service."
  type        = string
  default     = ""
}

variable "frontend_image" {
  description = "Docker image for the frontend service."
  type        = string
  default     = ""
}

variable "ecr_backend_repository_url" {
  description = "ECR backend repository URL (used when backend_image is empty)."
  type        = string
  default     = ""
}

variable "ecr_frontend_repository_url" {
  description = "ECR frontend repository URL (used when frontend_image is empty)."
  type        = string
  default     = ""
}
