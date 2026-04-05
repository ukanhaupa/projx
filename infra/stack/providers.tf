provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = var.environment
      Project     = var.project
      ManagedBy   = "terraform"
      Region      = var.aws_region
    }
  }
}

provider "aws" {
  alias  = "cicd"
  region = coalesce(var.cicd_region, var.aws_region)

  default_tags {
    tags = {
      Environment = var.environment
      Project     = var.project
      ManagedBy   = "terraform"
      Region      = coalesce(var.cicd_region, var.aws_region)
    }
  }
}

provider "kubernetes" {
  host                   = try(module.eks[0].cluster_endpoint, "")
  cluster_ca_certificate = base64decode(try(module.eks[0].cluster_certificate_authority_data, ""))

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--region", var.aws_region, "--cluster-name", try(module.eks[0].cluster_name, "")]
  }
}

provider "helm" {
  kubernetes = {
    host                   = try(module.eks[0].cluster_endpoint, "")
    cluster_ca_certificate = base64decode(try(module.eks[0].cluster_certificate_authority_data, ""))

    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--region", var.aws_region, "--cluster-name", try(module.eks[0].cluster_name, "")]
    }
  }
}
