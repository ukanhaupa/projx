output "aws_region" {
  value       = var.aws_region
  description = "AWS deployment region."
}

output "vpc_id" {
  value       = module.vpc.vpc_id
  description = "VPC ID for the environment."
}

output "private_subnet_ids" {
  value       = module.vpc.private_subnets
  description = "Private subnet IDs where EKS and RDS run."
}

output "eks_cluster_name" {
  value       = try(module.eks[0].cluster_name, null)
  description = "EKS cluster name (null when deployment_mode != k8s)."
}

output "eks_cluster_endpoint" {
  value       = try(module.eks[0].cluster_endpoint, null)
  description = "EKS API endpoint (null when deployment_mode != k8s)."
}

output "rds_address" {
  value       = aws_db_instance.shared.address
  description = "RDS endpoint for shared backend database services."
}

output "rds_port" {
  value       = aws_db_instance.shared.port
  description = "RDS PostgreSQL port."
}

output "db_secret_arn" {
  value       = aws_secretsmanager_secret.db_credentials.arn
  description = "Secrets Manager ARN for DB credentials."
}

output "db_reader_secret_arn" {
  value       = aws_secretsmanager_secret.db_reader_credentials.arn
  description = "Secrets Manager ARN for shared reader DB credentials."
}

output "keycloak_admin_secret_arn" {
  value       = try(module.k8s[0].keycloak_admin_secret_arn, try(module.compose[0].keycloak_admin_secret_arn, null))
  description = "Secrets Manager ARN for Keycloak admin credentials (null when enable_keycloak=false)."
}

output "backend_db_secret_arn" {
  value       = try(module.k8s[0].backend_db_secret_arn, null)
  description = "Secrets Manager ARN for backend application DB credentials (k8s mode only)."
}

output "compose_public_ip" {
  value       = try(module.compose[0].public_ip, null)
  description = "Public IP of the compose EC2 host (null when deployment_mode != compose)."
}

output "backend_internal_url" {
  value       = local.use_k8s ? "http://backend.${var.apps_namespace}.svc.cluster.local" : null
  description = "Internal cluster URL for backend service (k8s mode only)."
}

output "frontend_internal_url" {
  value       = local.use_k8s ? "http://frontend.${var.apps_namespace}.svc.cluster.local" : null
  description = "Internal cluster URL for frontend service (k8s mode only)."
}

output "sns_alerts_topic_arn" {
  value       = aws_sns_topic.alerts.arn
  description = "SNS topic ARN for CloudWatch alarm notifications. Subscribe an email or Slack webhook."
}

output "cloudwatch_dashboard_url" {
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${local.name_prefix}-overview"
  description = "URL to the CloudWatch dashboard for this environment."
}

output "compose_instance_id" {
  value       = try(module.compose[0].instance_id, null)
  description = "EC2 instance ID for compose host (null when deployment_mode != compose)."
}

output "rollback_codebuild_project_name" {
  value       = try(aws_codebuild_project.rollback[0].name, null)
  description = "Manual rollback CodeBuild project. Start with ROLLBACK_SERVICE and ROLLBACK_IMAGE_TAG environment overrides."
}
