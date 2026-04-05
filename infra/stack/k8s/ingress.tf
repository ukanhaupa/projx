data "aws_iam_policy_document" "alb_assume" {
  statement {
    effect = "Allow"

    principals {
      type        = "Federated"
      identifiers = [var.eks_oidc_provider_arn]
    }

    actions = ["sts:AssumeRoleWithWebIdentity"]

    condition {
      test     = "StringEquals"
      variable = "${var.eks_oidc_provider}:sub"
      values   = ["system:serviceaccount:kube-system:aws-load-balancer-controller"]
    }
  }
}

resource "aws_iam_role" "alb_controller" {
  name               = "${var.name_prefix}-alb-controller"
  assume_role_policy = data.aws_iam_policy_document.alb_assume.json
  tags               = var.tags
}

resource "aws_iam_policy" "alb_controller_policy" {
  name        = "${var.name_prefix}-alb-controller-policy"
  description = "Policy for AWS Load Balancer Controller."

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "ec2:CreateSecurityGroup",
          "ec2:DeleteSecurityGroup",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:CreateTags",
          "ec2:DeleteTags",
          "ec2:Describe*",
          "elasticloadbalancing:*",
          "iam:CreateServiceLinkedRole",
          "acm:DescribeCertificate",
          "acm:ListCertificates",
          "acm:GetCertificate",
          "wafv2:*",
          "shield:*"
        ],
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "alb_attach" {
  role       = aws_iam_role.alb_controller.name
  policy_arn = aws_iam_policy.alb_controller_policy.arn
}

resource "kubernetes_service_account_v1" "alb_controller" {
  metadata {
    name      = "aws-load-balancer-controller"
    namespace = "kube-system"

    annotations = {
      "eks.amazonaws.com/role-arn" = aws_iam_role.alb_controller.arn
    }
  }

  # dependencies on the EKS cluster are enforced via the k8s provider configuration
  # (which uses the cluster name / endpoint from the root module).
}

resource "helm_release" "aws_load_balancer_controller" {
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  namespace  = "kube-system"

  values = [
    yamlencode({
      clusterName = var.eks_cluster_name
      region      = var.aws_region

      serviceAccount = {
        create = false
        name   = kubernetes_service_account_v1.alb_controller.metadata[0].name
      }

      defaultTags = {
        env = var.environment
      }
    })
  ]

  depends_on = [
    kubernetes_service_account_v1.alb_controller,
    aws_iam_role_policy_attachment.alb_attach
  ]
}

resource "kubernetes_ingress_v1" "platform_ingress" {
  metadata {
    name      = "platform-ingress"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name

    annotations = {
      "kubernetes.io/ingress.class"                    = "alb"
      "alb.ingress.kubernetes.io/scheme"               = "internet-facing"
      "alb.ingress.kubernetes.io/target-type"          = "ip"
      "alb.ingress.kubernetes.io/listen-ports"         = var.environment == "prod" ? "[{\"HTTP\":80},{\"HTTPS\":443}]" : "[{\"HTTP\":80}]"
      "alb.ingress.kubernetes.io/ssl-redirect"         = var.environment == "prod" ? "443" : ""
      "alb.ingress.kubernetes.io/healthcheck-path"     = "/"
      "alb.ingress.kubernetes.io/healthcheck-interval" = "15"
      "alb.ingress.kubernetes.io/healthy-threshold"    = "2"
      "alb.ingress.kubernetes.io/unhealthy-threshold"  = "3"
    }
  }

  spec {
    rule {
      http {

        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service_v1.frontend.metadata[0].name

              port {
                number = 80
              }
            }
          }
        }

        dynamic "path" {
          for_each = var.environment == "dev" ? ["/docs"] : []
          content {
            path      = path.value
            path_type = "Prefix"

            backend {
              service {
                name = kubernetes_service_v1.backend.metadata[0].name

                port {
                  number = 80
                }
              }
            }
          }
        }

        path {
          path      = "/api"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service_v1.backend.metadata[0].name

              port {
                number = 80
              }
            }
          }
        }

        dynamic "path" {
          for_each = var.enable_keycloak ? [1] : []
          content {
            path      = "/auth"
            path_type = "Prefix"

            backend {
              service {
                name = "keycloak"

                port {
                  number = 80
                }
              }
            }
          }
        }

      }
    }
  }

  depends_on = [
    helm_release.aws_load_balancer_controller,
    kubernetes_service_v1.backend,
    kubernetes_service_v1.frontend,
    helm_release.keycloak,
  ]
}
