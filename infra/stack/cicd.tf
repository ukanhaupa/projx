data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "codebuild_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "codebuild" {
  count = var.cicd_enabled ? 1 : 0

  name               = "${local.cicd_name_prefix}-codebuild-role"
  assume_role_policy = data.aws_iam_policy_document.codebuild_assume_role.json

  tags = local.tags
}

data "aws_iam_policy_document" "codebuild_policy" {
  count = var.cicd_enabled ? 1 : 0

  statement {
    sid    = "CloudWatchLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "PipelineArtifacts"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:ListBucket"
    ]
    resources = [
      aws_s3_bucket.cicd_artifacts[0].arn,
      "${aws_s3_bucket.cicd_artifacts[0].arn}/*"
    ]
  }

  statement {
    sid    = "ECRPushPull"
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
      "ecr:BatchGetImage",
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart"
    ]
    resources = ["*"]
  }

  dynamic "statement" {
    for_each = local.use_k8s ? [1] : []

    content {
      sid    = "EksDeploy"
      effect = "Allow"
      actions = [
        "eks:DescribeCluster"
      ]
      resources = [try(module.eks[0].cluster_arn, "")]
    }
  }

  dynamic "statement" {
    for_each = local.use_compose ? [1] : []

    content {
      sid    = "ComposeSsmDeploy"
      effect = "Allow"
      actions = [
        "ssm:SendCommand",
        "ssm:GetCommandInvocation",
        "ssm:ListCommandInvocations"
      ]
      resources = ["*"]
    }
  }

  dynamic "statement" {
    for_each = local.use_compose ? [1] : []

    content {
      sid    = "ComposeDescribeInstances"
      effect = "Allow"
      actions = [
        "ec2:DescribeInstances"
      ]
      resources = ["*"]
    }
  }

  statement {
    sid    = "ReadCallerIdentity"
    effect = "Allow"
    actions = [
      "sts:GetCallerIdentity"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "CodeCommitDiff"
    effect = "Allow"
    actions = [
      "codecommit:GetDifferences",
      "codecommit:GetCommit"
    ]
    resources = [
      "arn:aws:codecommit:${local.cicd_region_effective}:${data.aws_caller_identity.current.account_id}:${local.codecommit_repo_name_effective}"
    ]
  }

  statement {
    sid    = "DeploymentStateParameter"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:PutParameter"
    ]
    resources = [
      aws_ssm_parameter.backend_last_deployed_commit[0].arn,
      aws_ssm_parameter.frontend_last_deployed_commit[0].arn
    ]
  }
}

resource "aws_iam_role_policy" "codebuild" {
  count = var.cicd_enabled ? 1 : 0

  name   = "${local.cicd_name_prefix}-codebuild-policy"
  role   = aws_iam_role.codebuild[0].id
  policy = data.aws_iam_policy_document.codebuild_policy[0].json
}

data "aws_iam_policy_document" "codepipeline_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["codepipeline.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "codepipeline" {
  count = var.cicd_enabled ? 1 : 0

  name               = "${local.cicd_name_prefix}-codepipeline-role"
  assume_role_policy = data.aws_iam_policy_document.codepipeline_assume_role.json

  tags = local.tags
}

data "aws_iam_policy_document" "codepipeline_policy" {
  count = var.cicd_enabled ? 1 : 0

  statement {
    sid    = "CodeCommitSource"
    effect = "Allow"
    actions = [
      "codecommit:GetBranch",
      "codecommit:GetCommit",
      "codecommit:UploadArchive",
      "codecommit:GetUploadArchiveStatus",
      "codecommit:CancelUploadArchive"
    ]
    resources = [
      "arn:aws:codecommit:${local.cicd_region_effective}:${data.aws_caller_identity.current.account_id}:${local.codecommit_repo_name_effective}"
    ]
  }

  statement {
    sid    = "CodeBuildInvoke"
    effect = "Allow"
    actions = [
      "codebuild:BatchGetBuilds",
      "codebuild:StartBuild"
    ]
    resources = [
      aws_codebuild_project.backend[0].arn,
      aws_codebuild_project.frontend[0].arn
    ]
  }

  statement {
    sid    = "PipelineArtifacts"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:ListBucket"
    ]
    resources = [
      aws_s3_bucket.cicd_artifacts[0].arn,
      "${aws_s3_bucket.cicd_artifacts[0].arn}/*"
    ]
  }
}

resource "aws_iam_role_policy" "codepipeline" {
  count = var.cicd_enabled ? 1 : 0

  name   = "${local.cicd_name_prefix}-codepipeline-policy"
  role   = aws_iam_role.codepipeline[0].id
  policy = data.aws_iam_policy_document.codepipeline_policy[0].json
}

resource "aws_ecr_repository" "backend" {
  count = var.cicd_enabled ? 1 : 0

  name                 = "${var.project}/${var.environment}/backend"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.tags
}

resource "aws_ecr_lifecycle_policy" "backend" {
  count = var.cicd_enabled ? 1 : 0

  repository = aws_ecr_repository.backend[0].name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Retain latest ${var.cicd_ecr_keep_image_count} backend images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.cicd_ecr_keep_image_count
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_ecr_repository" "frontend" {
  count = var.cicd_enabled ? 1 : 0

  name                 = "${var.project}/${var.environment}/frontend"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.tags
}

resource "aws_ecr_lifecycle_policy" "frontend" {
  count = var.cicd_enabled ? 1 : 0

  repository = aws_ecr_repository.frontend[0].name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Retain latest ${var.cicd_ecr_keep_image_count} frontend images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.cicd_ecr_keep_image_count
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_eks_access_entry" "codebuild" {
  count = var.cicd_enabled && local.use_k8s ? 1 : 0

  cluster_name  = try(module.eks[0].cluster_name, "")
  principal_arn = aws_iam_role.codebuild[0].arn
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "codebuild_admin" {
  count = var.cicd_enabled && local.use_k8s ? 1 : 0

  cluster_name  = try(module.eks[0].cluster_name, "")
  principal_arn = aws_iam_role.codebuild[0].arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }
}

resource "aws_s3_bucket" "cicd_artifacts" {
  count    = var.cicd_enabled ? 1 : 0
  provider = aws.cicd

  bucket        = "${local.cicd_name_prefix}-${data.aws_caller_identity.current.account_id}-artifacts"
  force_destroy = true

  tags = local.tags
}

resource "aws_s3_bucket_versioning" "cicd_artifacts" {
  count    = var.cicd_enabled ? 1 : 0
  provider = aws.cicd

  bucket = aws_s3_bucket.cicd_artifacts[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cicd_artifacts" {
  count    = var.cicd_enabled ? 1 : 0
  provider = aws.cicd

  bucket = aws_s3_bucket.cicd_artifacts[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_ssm_parameter" "backend_last_deployed_commit" {
  count    = var.cicd_enabled ? 1 : 0
  provider = aws.cicd

  name  = "/${var.project}/${var.environment}/cicd/backend-last-deployed-commit"
  type  = "String"
  value = "INITIAL"

  tags = local.tags
}

resource "aws_ssm_parameter" "frontend_last_deployed_commit" {
  count    = var.cicd_enabled ? 1 : 0
  provider = aws.cicd

  name  = "/${var.project}/${var.environment}/cicd/frontend-last-deployed-commit"
  type  = "String"
  value = "INITIAL"

  tags = local.tags
}

resource "aws_codebuild_project" "backend" {
  count    = var.cicd_enabled ? 1 : 0
  provider = aws.cicd

  name          = "${local.cicd_name_prefix}-backend"
  service_role  = aws_iam_role.codebuild[0].arn
  build_timeout = 30

  source {
    type      = "CODEPIPELINE"
    buildspec = "infra/cicd/buildspec.backend.yml"
  }

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_MEDIUM"
    image                       = "aws/codebuild/standard:7.0"
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"
    privileged_mode             = true

    environment_variable {
      name  = "TARGET_AWS_REGION"
      value = var.aws_region
    }

    environment_variable {
      name  = "EKS_CLUSTER_NAME"
      value = local.use_k8s ? try(module.eks[0].cluster_name, "") : ""
    }

    environment_variable {
      name  = "APPS_NAMESPACE"
      value = var.apps_namespace
    }

    environment_variable {
      name  = "ECR_REPOSITORY_URL"
      value = aws_ecr_repository.backend[0].repository_url
    }

    environment_variable {
      name  = "CICD_REGION"
      value = local.cicd_region_effective
    }

    environment_variable {
      name  = "CODECOMMIT_REPO_NAME"
      value = local.codecommit_repo_name_effective
    }

    environment_variable {
      name  = "FOLDER_PATH"
      value = "backend"
    }

    environment_variable {
      name  = "DEPLOY_STATE_PARAM"
      value = aws_ssm_parameter.backend_last_deployed_commit[0].name
    }

    environment_variable {
      name  = "COMPOSE_INSTANCE_TAG"
      value = "${local.name_prefix}-compose"
    }
  }

  logs_config {
    cloudwatch_logs {
      status      = "ENABLED"
      group_name  = "/aws/codebuild/${local.cicd_name_prefix}-backend"
      stream_name = "build-log"
    }
  }

  tags = local.tags
}

resource "aws_codebuild_project" "frontend" {
  count    = var.cicd_enabled ? 1 : 0
  provider = aws.cicd

  name          = "${local.cicd_name_prefix}-frontend"
  service_role  = aws_iam_role.codebuild[0].arn
  build_timeout = 30

  source {
    type      = "CODEPIPELINE"
    buildspec = "infra/cicd/buildspec.frontend.yml"
  }

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_MEDIUM"
    image                       = "aws/codebuild/standard:7.0"
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"
    privileged_mode             = true

    environment_variable {
      name  = "TARGET_AWS_REGION"
      value = var.aws_region
    }

    environment_variable {
      name  = "EKS_CLUSTER_NAME"
      value = local.use_k8s ? try(module.eks[0].cluster_name, "") : ""
    }

    environment_variable {
      name  = "APPS_NAMESPACE"
      value = var.apps_namespace
    }

    environment_variable {
      name  = "ECR_REPOSITORY_URL"
      value = aws_ecr_repository.frontend[0].repository_url
    }

    environment_variable {
      name  = "CICD_REGION"
      value = local.cicd_region_effective
    }

    environment_variable {
      name  = "CODECOMMIT_REPO_NAME"
      value = local.codecommit_repo_name_effective
    }

    environment_variable {
      name  = "FOLDER_PATH"
      value = "frontend"
    }

    environment_variable {
      name  = "DEPLOY_STATE_PARAM"
      value = aws_ssm_parameter.frontend_last_deployed_commit[0].name
    }

    environment_variable {
      name  = "COMPOSE_INSTANCE_TAG"
      value = "${local.name_prefix}-compose"
    }
  }

  logs_config {
    cloudwatch_logs {
      status      = "ENABLED"
      group_name  = "/aws/codebuild/${local.cicd_name_prefix}-frontend"
      stream_name = "build-log"
    }
  }

  tags = local.tags
}

resource "aws_codepipeline" "apps" {
  count    = var.cicd_enabled ? 1 : 0
  provider = aws.cicd

  name     = "${local.cicd_name_prefix}-apps"
  role_arn = aws_iam_role.codepipeline[0].arn

  artifact_store {
    location = aws_s3_bucket.cicd_artifacts[0].bucket
    type     = "S3"
  }

  stage {
    name = "Source"

    action {
      name             = "Source"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeCommit"
      version          = "1"
      output_artifacts = ["source_output"]

      configuration = {
        RepositoryName       = local.codecommit_repo_name_effective
        BranchName           = local.cicd_branch
        PollForSourceChanges = "false"
      }
    }
  }

  stage {
    name = "Deploy"

    action {
      name             = "DeployBackend"
      category         = "Build"
      owner            = "AWS"
      provider         = "CodeBuild"
      version          = "1"
      input_artifacts  = ["source_output"]
      output_artifacts = ["backend_output"]

      configuration = {
        ProjectName = aws_codebuild_project.backend[0].name
      }
    }

    action {
      name             = "DeployFrontend"
      category         = "Build"
      owner            = "AWS"
      provider         = "CodeBuild"
      version          = "1"
      input_artifacts  = ["source_output"]
      output_artifacts = ["frontend_output"]

      configuration = {
        ProjectName = aws_codebuild_project.frontend[0].name
      }
    }
  }

  tags = local.tags
}

# ── EventBridge rule: trigger pipeline on CodeCommit branch push ──────────────

resource "aws_iam_role" "events_pipeline" {
  count = var.cicd_enabled ? 1 : 0

  name = "${local.cicd_name_prefix}-events-pipeline-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "events_pipeline" {
  count = var.cicd_enabled ? 1 : 0

  name = "${local.cicd_name_prefix}-events-pipeline-policy"
  role = aws_iam_role.events_pipeline[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["codepipeline:StartPipelineExecution"]
      Resource = [aws_codepipeline.apps[0].arn]
    }]
  })
}

resource "aws_cloudwatch_event_rule" "pipeline_trigger" {
  count    = var.cicd_enabled ? 1 : 0
  provider = aws.cicd

  name        = "${local.cicd_name_prefix}-pipeline-trigger"
  description = "Trigger CodePipeline on CodeCommit push to ${local.cicd_branch}"

  event_pattern = jsonencode({
    source        = ["aws.codecommit"]
    "detail-type" = ["CodeCommit Repository State Change"]
    resources     = ["arn:aws:codecommit:${local.cicd_region_effective}:${data.aws_caller_identity.current.account_id}:${local.codecommit_repo_name_effective}"]
    detail = {
      event         = ["referenceCreated", "referenceUpdated"]
      referenceType = ["branch"]
      referenceName = [local.cicd_branch]
    }
  })

  tags = local.tags
}

resource "aws_cloudwatch_event_target" "pipeline_trigger" {
  count    = var.cicd_enabled ? 1 : 0
  provider = aws.cicd

  rule     = aws_cloudwatch_event_rule.pipeline_trigger[0].name
  arn      = aws_codepipeline.apps[0].arn
  role_arn = aws_iam_role.events_pipeline[0].arn
}
