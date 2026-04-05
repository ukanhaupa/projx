output "public_ip" {
  description = "Public IPv4 address of the compose host."
  value       = aws_eip.compose.public_ip
}

output "public_dns" {
  description = "Public DNS of the compose host."
  value       = aws_instance.compose.public_dns
}

output "instance_id" {
  description = "EC2 instance ID of the compose host."
  value       = aws_instance.compose.id
}

output "keycloak_admin_secret_arn" {
  description = "Secrets Manager ARN for Keycloak admin credentials (null when enable_keycloak=false)."
  value       = try(aws_secretsmanager_secret.keycloak_admin[0].arn, null)
}

output "security_group_id" {
  description = "Security group ID attached to the compose host."
  value       = aws_security_group.compose.id
}
