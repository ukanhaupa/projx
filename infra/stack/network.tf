module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.19"

  name = "${local.name_prefix}-vpc"
  cidr = var.vpc_cidr

  azs              = local.azs
  private_subnets  = [for idx, _ in local.azs : cidrsubnet(var.vpc_cidr, 4, idx)]
  public_subnets   = [for idx, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, idx + 48)]
  database_subnets = [for idx, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, idx + 56)]

  create_database_subnet_group           = true
  create_database_subnet_route_table     = true
  create_database_internet_gateway_route = false

  enable_nat_gateway = local.use_k8s
  single_nat_gateway = var.environment != "prod"

  enable_dns_hostnames = true
  enable_dns_support   = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = 1
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = 1
  }

  database_subnet_tags = {
    Tier = "database"
  }

  tags = local.tags
}
