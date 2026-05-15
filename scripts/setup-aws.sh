#!/usr/bin/env bash
# Install AWS CLI v2 on Ubuntu so the deploy workflow can authenticate to ECR
# from the EC2 instance using its attached IAM role.
#
# Idempotent: re-running upgrades AWS CLI v2 in place if a newer version is
# available, otherwise no-ops.
#
# Usage: ./scripts/setup-aws.sh

set -euo pipefail

if [ ! -r /etc/os-release ]; then
  echo "ERROR: /etc/os-release not found; this script supports Ubuntu only."
  exit 1
fi
. /etc/os-release
if [ "${ID:-}" != "ubuntu" ]; then
  echo "ERROR: detected '$ID'; this script supports Ubuntu only."
  exit 1
fi

echo "=== Ensuring unzip + curl are present ==="
if ! command -v unzip >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y unzip curl
fi

echo "=== Installing or updating AWS CLI v2 ==="
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  AWSCLI_URL="https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" ;;
  aarch64) AWSCLI_URL="https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" ;;
  *)       echo "ERROR: unsupported architecture '$ARCH'"; exit 1 ;;
esac

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

curl -fsSL "$AWSCLI_URL" -o "$WORKDIR/awscliv2.zip"
unzip -q -o "$WORKDIR/awscliv2.zip" -d "$WORKDIR"

if command -v aws >/dev/null 2>&1; then
  sudo "$WORKDIR/aws/install" --update
else
  sudo "$WORKDIR/aws/install"
fi

echo "=== Versions ==="
aws --version

echo "=== Verifying IAM instance role ==="
if ! aws sts get-caller-identity --output json; then
  echo ""
  echo "WARNING: caller-identity failed. The instance is missing or has the"
  echo "wrong IAM instance profile. Expected: memoria-ec2-role."
  exit 1
fi

echo ""
echo "=== Verifying ECR auth ==="
if ! aws ecr get-login-password --region "${AWS_REGION:-us-east-1}" >/dev/null; then
  echo "ERROR: cannot authenticate to ECR. Check that the EC2 IAM role grants"
  echo "ecr:GetAuthorizationToken."
  exit 1
fi
echo "ECR auth OK."

echo ""
echo "=== Done ==="
echo "AWS CLI installed and IAM role validated."
echo "The deploy workflow can now pull images from ECR on this host."
