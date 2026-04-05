# Compose-based Deployment (EC2 + Docker Compose)

This folder contains a minimal Terraform configuration to deploy an EC2 instance with an Elastic IP and run a basic Docker Compose stack (currently just an nginx container).

## Usage

From this folder:

```sh
terraform init -backend-config=backend.dev.config
terraform plan -var-file=../environments/dev.tfvars
terraform apply -var-file=../environments/dev.tfvars
```

### Variables

- `ssh_key_name` - (optional) EC2 Key Pair name to enable SSH access.
- `allowed_ssh_cidr` - CIDR range allowed for SSH (default `0.0.0.0/0`).
- `instance_type` - EC2 instance type (default `t3.small`).

## Notes

- The instance is launched into the default VPC.
- The user-data script installs Docker/Docker Compose and starts an nginx container bound to port 80.
- The public IP is exposed via an Elastic IP and is available as Terraform output `instance_public_ip`.
