resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"
  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name_prefix}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU utilization above 80% for 15 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.shared.identifier
  }

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "${local.name_prefix}-rds-connections-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.environment == "prod" ? 80 : 40
  alarm_description   = "RDS connection count above threshold"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.shared.identifier
  }

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  alarm_name          = "${local.name_prefix}-rds-storage-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 5368709120
  alarm_description   = "RDS free storage below 5 GB"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.shared.identifier
  }

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_read_latency" {
  alarm_name          = "${local.name_prefix}-rds-read-latency-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "ReadLatency"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 0.02
  alarm_description   = "RDS read latency above 20ms for 15 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.shared.identifier
  }

  tags = local.tags
}

# ── Compose: EC2 status check alarm ──────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "compose_status_check" {
  count               = local.use_compose ? 1 : 0
  alarm_name          = "${local.name_prefix}-compose-status-check-failed"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "EC2 instance failed status check — host or system issue"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    InstanceId = module.compose[0].instance_id
  }

  tags = local.tags
}

# ── Compose: backend health check via log-based metric ───────────────────────

resource "aws_cloudwatch_log_metric_filter" "backend_errors" {
  count          = local.use_compose ? 1 : 0
  name           = "${local.name_prefix}-backend-5xx-errors"
  log_group_name = "/app/${var.project}/${var.environment}/compose"
  pattern        = "\"HTTP/1.1\\\" 5\""

  metric_transformation {
    name          = "Backend5xxCount"
    namespace     = "${local.name_prefix}/Application"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "backend_error_rate" {
  count               = local.use_compose ? 1 : 0
  alarm_name          = "${local.name_prefix}-backend-5xx-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Backend5xxCount"
  namespace           = "${local.name_prefix}/Application"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "Backend returning >10 5xx errors in 5 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  tags = local.tags
}

# ── RDS: write latency alarm ─────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "rds_write_latency" {
  alarm_name          = "${local.name_prefix}-rds-write-latency-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "WriteLatency"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 0.02
  alarm_description   = "RDS write latency above 20ms for 15 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.shared.identifier
  }

  tags = local.tags
}

# ── Dashboard ────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${local.name_prefix}-overview"

  dashboard_body = jsonencode({
    widgets = concat(
      [
        {
          type   = "metric"
          x      = 0
          y      = 0
          width  = 12
          height = 6
          properties = {
            title   = "RDS CPU Utilization"
            metrics = [["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.shared.identifier]]
            period  = 300
            stat    = "Average"
            region  = var.aws_region
            view    = "timeSeries"
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 0
          width  = 12
          height = 6
          properties = {
            title   = "RDS Database Connections"
            metrics = [["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", aws_db_instance.shared.identifier]]
            period  = 300
            stat    = "Average"
            region  = var.aws_region
            view    = "timeSeries"
          }
        },
        {
          type   = "metric"
          x      = 0
          y      = 6
          width  = 12
          height = 6
          properties = {
            title = "RDS Free Storage (GB)"
            metrics = [["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", aws_db_instance.shared.identifier, {
              label = "Free Storage"
            }]]
            period = 300
            stat   = "Average"
            region = var.aws_region
            view   = "timeSeries"
            yAxis = {
              left = {
                label     = "Bytes"
                showUnits = false
              }
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 6
          width  = 12
          height = 6
          properties = {
            title = "RDS Read/Write Latency"
            metrics = [
              ["AWS/RDS", "ReadLatency", "DBInstanceIdentifier", aws_db_instance.shared.identifier, { label = "Read" }],
              ["AWS/RDS", "WriteLatency", "DBInstanceIdentifier", aws_db_instance.shared.identifier, { label = "Write" }]
            ]
            period = 300
            stat   = "Average"
            region = var.aws_region
            view   = "timeSeries"
          }
        }
      ],
      local.use_k8s ? [
        {
          type   = "metric"
          x      = 0
          y      = 12
          width  = 12
          height = 6
          properties = {
            title   = "EKS Node CPU Utilization"
            metrics = [["AWS/EKS", "node_cpu_utilization", "ClusterName", try(module.eks[0].cluster_name, "")]]
            period  = 300
            stat    = "Average"
            region  = var.aws_region
            view    = "timeSeries"
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 12
          width  = 12
          height = 6
          properties = {
            title   = "EKS Node Memory Utilization"
            metrics = [["AWS/EKS", "node_memory_utilization", "ClusterName", try(module.eks[0].cluster_name, "")]]
            period  = 300
            stat    = "Average"
            region  = var.aws_region
            view    = "timeSeries"
          }
        }
      ] : [],
      local.use_compose ? [
        {
          type   = "metric"
          x      = 0
          y      = 12
          width  = 12
          height = 6
          properties = {
            title   = "EC2 CPU Utilization"
            metrics = [["AWS/EC2", "CPUUtilization", "InstanceId", try(module.compose[0].instance_id, "")]]
            period  = 300
            stat    = "Average"
            region  = var.aws_region
            view    = "timeSeries"
          }
        }
      ] : []
    )
  })
}
