data "aws_ip_ranges" "codebuild" {
  count = var.cicd_enabled && var.allow_cicd_codebuild_eks_api_access ? 1 : 0

  services = ["CODEBUILD"]
  regions  = [local.cicd_region_effective]
}

locals {
  eks_public_access_cidrs = distinct(concat(
    var.public_access_cidrs,
    var.cicd_enabled && var.allow_cicd_codebuild_eks_api_access ? data.aws_ip_ranges.codebuild[0].cidr_blocks : []
  ))
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.34"
  count   = local.use_k8s ? 1 : 0

  cluster_name    = "${local.name_prefix}-eks"
  cluster_version = var.kubernetes_version

  cluster_endpoint_public_access           = true
  cluster_endpoint_private_access          = true
  cluster_endpoint_public_access_cidrs     = local.eks_public_access_cidrs
  enable_cluster_creator_admin_permissions = true

  enable_irsa = true

  iam_role_use_name_prefix = false
  iam_role_name            = "${local.name_prefix}-eks-role"

  cluster_enabled_log_types = [
    "api",
    "audit",
    "authenticator",
    "controllerManager",
    "scheduler"
  ]

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  eks_managed_node_groups = {
    default = {
      instance_types = var.node_instance_types
      desired_size   = var.node_desired_size
      min_size       = var.node_min_size
      max_size       = var.node_max_size

      iam_role_additional_policies = {
        cloudwatch = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
        ecr        = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
      }
    }
  }

  tags = local.tags
}
