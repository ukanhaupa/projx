resource "random_password" "db_password" {
  length  = 24
  special = false # special chars in PGPASSWORD break shell heredoc assignment in compose user-data
}

resource "aws_secretsmanager_secret" "db_credentials" {
  name                    = "${local.name_prefix}/db/master"
  description             = "Master database credentials for ${var.environment}"
  recovery_window_in_days = 0

  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db_password.result
    database = var.db_name
  })
}

resource "aws_secretsmanager_secret" "db_reader_credentials" {
  name                    = "${local.name_prefix}/db/reader"
  description             = "Shared reader database credentials for ${var.environment}"
  recovery_window_in_days = 0

  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "db_reader_credentials" {
  secret_id = aws_secretsmanager_secret.db_reader_credentials.id
  secret_string = jsonencode({
    host     = aws_db_instance.shared.address
    port     = aws_db_instance.shared.port
    database = local.backend_db_name_effective
    username = var.db_reader_username
    password = var.db_reader_password
  })
}

resource "aws_db_subnet_group" "keycloak" {
  name       = var.db_publicly_accessible ? "${local.name_prefix}-db-subnet-public" : "${local.name_prefix}-db-subnet-isolated"
  subnet_ids = var.db_publicly_accessible ? module.vpc.public_subnets : module.vpc.database_subnets

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.tags, {
    Name = var.db_publicly_accessible ? "${local.name_prefix}-db-subnet-public" : "${local.name_prefix}-db-subnet-isolated"
  })
}

data "aws_vpc" "selected" {
  id = module.vpc.vpc_id
}

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds-sg"
  description = "Allow PostgreSQL traffic from inside the VPC (and optional public CIDRs)."
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.selected.cidr_block]
    description = "PostgreSQL access from within the VPC"
  }

  dynamic "ingress" {
    for_each = var.db_publicly_accessible ? var.db_public_access_cidrs : []

    content {
      from_port   = 5432
      to_port     = 5432
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
      description = "PostgreSQL direct access"
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

resource "aws_iam_role" "rds_monitoring" {
  name = "${local.name_prefix}-rds-monitoring-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "monitoring.rds.amazonaws.com"
      }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_db_instance" "shared" {
  identifier     = "${replace(local.name_prefix, "_", "-")}-db"
  engine         = "postgres"
  engine_version = "16.13"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_password.result

  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.keycloak.name

  multi_az                        = var.db_multi_az
  backup_retention_period         = var.db_backup_retention_days
  performance_insights_enabled    = true
  monitoring_interval             = 60
  monitoring_role_arn             = aws_iam_role.rds_monitoring.arn
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  publicly_accessible        = var.db_publicly_accessible
  auto_minor_version_upgrade = true
  apply_immediately          = var.environment != "prod"
  copy_tags_to_snapshot      = true

  skip_final_snapshot       = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${replace(local.name_prefix, "_", "-")}-db-final" : null
  deletion_protection       = var.environment == "prod"

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-db"
  })

  depends_on = [aws_iam_role_policy_attachment.rds_monitoring]
}
