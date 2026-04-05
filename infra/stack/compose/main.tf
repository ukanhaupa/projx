# Single EC2 host running all services via Docker Compose:
# backend + frontend + keycloak (optional) + nginx routing
# VPC and subnets are supplied by the root stack.

locals {
  resolved_backend_image  = var.backend_image != "" ? var.backend_image : (var.ecr_backend_repository_url != "" ? "${var.ecr_backend_repository_url}:latest" : "")
  resolved_frontend_image = var.frontend_image != "" ? var.frontend_image : (var.ecr_frontend_repository_url != "" ? "${var.ecr_frontend_repository_url}:latest" : "")
  node_env                = var.environment == "prod" ? "production" : "development"

  keycloak_groups_json_resolved = trimspace(var.keycloak_groups_json) != "" ? var.keycloak_groups_json : (var.keycloak_groups_json_file_path != "" ? file(var.keycloak_groups_json_file_path) : "[]")
  keycloak_users_json_resolved  = trimspace(var.keycloak_users_json) != "" ? var.keycloak_users_json : (var.keycloak_users_json_file_path != "" ? file(var.keycloak_users_json_file_path) : "[]")

  keycloak_realm_json = var.enable_keycloak ? templatefile(var.keycloak_realm_template_path, {
    realm_name                   = var.keycloak_realm_name
    realm_display_name           = var.keycloak_realm_display_name
    remember_me                  = tostring(var.keycloak_remember_me)
    client_id                    = var.keycloak_client_id
    client_name                  = var.keycloak_client_name
    client_secret                = var.keycloak_client_secret
    direct_access_grants_enabled = tostring(var.keycloak_direct_access_grants_enabled)
    groups_json                  = local.keycloak_groups_json_resolved
    users_json                   = local.keycloak_users_json_resolved
  }) : ""
}

data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

# ── Keycloak admin password (generated, stored in Secrets Manager) ────────────

resource "random_password" "keycloak_admin" {
  count   = var.enable_keycloak ? 1 : 0
  length  = 24
  special = false
}

resource "random_password" "keycloak_db" {
  count   = var.enable_keycloak ? 1 : 0
  length  = 24
  special = false
}

resource "aws_secretsmanager_secret" "keycloak_admin" {
  count                   = var.enable_keycloak ? 1 : 0
  name                    = "${var.name_prefix}/keycloak/admin"
  description             = "Keycloak admin credentials (compose mode) for ${var.environment}"
  recovery_window_in_days = 0
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "keycloak_admin" {
  count     = var.enable_keycloak ? 1 : 0
  secret_id = aws_secretsmanager_secret.keycloak_admin[0].id
  secret_string = jsonencode({
    username = "admin"
    password = random_password.keycloak_admin[0].result
  })
}

resource "aws_secretsmanager_secret" "backend_db" {
  name                    = "${var.name_prefix}/db/backend"
  description             = "Backend application DB credentials for ${var.environment}"
  recovery_window_in_days = 0
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "backend_db" {
  secret_id = aws_secretsmanager_secret.backend_db.id
  secret_string = jsonencode({
    host     = var.db_host
    port     = var.db_port
    database = var.backend_db_name
    username = var.backend_db_username
    password = var.backend_db_password
  })
}

resource "aws_secretsmanager_secret" "keycloak_db" {
  count                   = var.enable_keycloak ? 1 : 0
  name                    = "${var.name_prefix}/keycloak/db"
  description             = "Keycloak database credentials for ${var.environment}"
  recovery_window_in_days = 0
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "keycloak_db" {
  count     = var.enable_keycloak ? 1 : 0
  secret_id = aws_secretsmanager_secret.keycloak_db[0].id
  secret_string = jsonencode({
    host     = var.db_host
    port     = var.db_port
    database = var.keycloak_db_name
    username = var.keycloak_db_username
    password = random_password.keycloak_db[0].result
  })
}

# ── CloudWatch log group ──────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "compose" {
  name              = "/app/${var.project}/${var.environment}/compose"
  retention_in_days = var.environment == "prod" ? 90 : 30

  tags = var.tags
}

# ── IAM instance profile (ECR pull + CloudWatch Logs) ────────────────────────

resource "aws_iam_role" "ec2" {
  name = "${var.name_prefix}-compose-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ec2_ecr" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy_attachment" "ec2_ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "ec2_secrets" {
  name = "${var.name_prefix}-compose-ec2-secrets-policy"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = ["arn:aws:secretsmanager:${var.aws_region}:*:secret:${var.name_prefix}/*"]
    }]
  })
}

resource "aws_iam_role_policy" "ec2_cloudwatch_logs" {
  name = "${var.name_prefix}-compose-ec2-logs-policy"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ]
      Resource = ["${aws_cloudwatch_log_group.compose.arn}:*"]
    }]
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.name_prefix}-compose-ec2-profile"
  role = aws_iam_role.ec2.name
}

# ── Security group ────────────────────────────────────────────────────────────

resource "aws_security_group" "compose" {
  name        = "${var.name_prefix}-compose-sg"
  description = "HTTP/HTTPS/SSH access to the compose host."
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = var.allowed_ssh_cidr != "" ? [var.allowed_ssh_cidr] : []
    content {
      description = "SSH"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-compose-sg" })
}

# ── EC2 instance ──────────────────────────────────────────────────────────────

data "cloudinit_config" "compose" {
  gzip          = true
  base64_encode = true

  part {
    content_type = "text/x-shellscript"
    filename     = "user-data.sh"
    content = templatefile("${path.module}/user-data.sh.tftpl", {
      aws_region                  = var.aws_region
      environment                 = var.environment
      node_env                    = local.node_env
      log_group_name              = aws_cloudwatch_log_group.compose.name
      backend_image               = local.resolved_backend_image
      frontend_image              = local.resolved_frontend_image
      db_host                     = var.db_host
      db_port                     = var.db_port
      db_master_user              = var.db_master_user
      db_master_password          = var.db_master_password
      backend_db_name             = var.backend_db_name
      backend_db_username         = var.backend_db_username
      backend_port                = var.backend_port
      backend_db_password         = var.backend_db_password
      backend_db_password_encoded = urlencode(var.backend_db_password)
      db_reader_username          = var.db_reader_username
      db_reader_password          = var.db_reader_password
      enable_keycloak             = var.enable_keycloak
      keycloak_db_name            = var.keycloak_db_name
      keycloak_db_username        = var.keycloak_db_username
      keycloak_db_password        = var.enable_keycloak ? random_password.keycloak_db[0].result : ""
      keycloak_admin_password     = var.enable_keycloak ? random_password.keycloak_admin[0].result : ""
    })
  }

  dynamic "part" {
    for_each = var.enable_keycloak ? [1] : []
    content {
      content_type = "text/cloud-config"
      filename     = "write-realm-json.cfg"
      content = yamlencode({
        write_files = [{
          path        = "/opt/keycloak-import/realm.json"
          permissions = "0644"
          content     = local.keycloak_realm_json
        }]
      })
    }
  }
}

resource "aws_instance" "compose" {
  ami                    = data.aws_ami.amazon_linux_2023.id
  instance_type          = var.instance_type
  subnet_id              = element(var.subnet_ids, 0)
  vpc_security_group_ids = [aws_security_group.compose.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  key_name               = var.ssh_key_name != "" ? var.ssh_key_name : null

  # user_data is rendered once at creation. To reprovision, replace the instance.
  user_data_base64 = data.cloudinit_config.compose.rendered

  tags = merge(var.tags, { Name = "${var.name_prefix}-compose" })

  lifecycle {
    ignore_changes = [user_data_base64]
  }
}

resource "aws_eip" "compose" {
  instance = aws_instance.compose.id
  domain   = "vpc"

  tags = merge(var.tags, { Name = "${var.name_prefix}-compose-eip" })
}
