# Backend configuration is injected at init time by bin/tf via -backend-config.
# Never run "terraform init" directly — always use bin/tf which generates
# the bucket name, state key, and region from .env.<environment>.
terraform {
  backend "s3" {}
}
