output "keycloak_admin_secret_arn" {
  value       = try(aws_secretsmanager_secret.keycloak_admin[0].arn, null)
  description = "Secrets Manager ARN for Keycloak admin credentials (null when enable_keycloak=false)."
}

output "backend_db_secret_arn" {
  value       = aws_secretsmanager_secret.backend_db_credentials.arn
  description = "Secrets Manager ARN for backend application DB credentials."
}
