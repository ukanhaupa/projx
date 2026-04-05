resource "aws_secretsmanager_secret" "backend_db_credentials" {
  name                    = "${var.name_prefix}/db/backend"
  description             = "Backend application DB credentials for ${var.environment}"
  recovery_window_in_days = 0

  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "backend_db_credentials" {
  secret_id = aws_secretsmanager_secret.backend_db_credentials.id
  secret_string = jsonencode({
    host     = var.db_host
    port     = var.db_port
    database = var.backend_db_name
    username = var.backend_db_username
    password = var.backend_db_password
  })
}

resource "kubernetes_namespace_v1" "apps" {
  metadata {
    name = var.apps_namespace
    labels = {
      project = var.project
    }
  }

  # no explicit dependency on the EKS module; Kubernetes provider configuration will ensure correct ordering.
}

locals {
  ecr_backend_image  = var.cicd_enabled ? "${var.ecr_backend_repository_url}:latest" : ""
  ecr_frontend_image = var.cicd_enabled ? "${var.ecr_frontend_repository_url}:latest" : ""

  resolved_backend_image  = var.backend_image != "" ? var.backend_image : local.ecr_backend_image
  resolved_frontend_image = var.frontend_image != "" ? var.frontend_image : local.ecr_frontend_image
}

resource "kubernetes_secret_v1" "backend_env" {
  metadata {
    name      = "backend-env"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
  }

  data = {
    DATABASE_URL       = "postgresql://${var.backend_db_username}:${urlencode(var.backend_db_password)}@${var.db_host}:${var.db_port}/${var.backend_db_name}?sslmode=require"
    PORT               = tostring(var.backend_port)
    HOST               = "0.0.0.0"
    CORS_ALLOW_ORIGINS = var.backend_cors_allow_origins
    NODE_ENV           = var.environment == "prod" ? "production" : "development"
    LOG_LEVEL          = "info"
    JWT_PROVIDER       = var.backend_jwt_provider
    JWT_ALGORITHMS     = var.backend_jwt_algorithms
    JWT_JWKS_URL       = var.backend_jwt_jwks_url != "" ? var.backend_jwt_jwks_url : "http://keycloak.${var.apps_namespace}.svc.cluster.local/auth/realms/${var.keycloak_realm_name}/protocol/openid-connect/certs"
    JWT_ISSUER         = var.backend_jwt_issuer != "" ? var.backend_jwt_issuer : "http://keycloak.${var.apps_namespace}.svc.cluster.local/auth/realms/${var.keycloak_realm_name}"
    JWT_AUDIENCE       = var.backend_jwt_audience
    JWT_REQUIRE_EXP    = "true"
    JWT_VERIFY_NBF     = "true"
    JWT_VERIFY_IAT     = "false"
  }

  type = "Opaque"

  depends_on = [kubernetes_job_v1.keycloak_db_bootstrap]
}

resource "kubernetes_deployment_v1" "backend" {
  metadata {
    name      = "backend"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
    labels = {
      app = "backend"
    }
  }

  spec {
    replicas = var.backend_replicas

    selector {
      match_labels = {
        app = "backend"
      }
    }

    strategy {
      type = "RollingUpdate"
      rolling_update {
        max_unavailable = "0"
        max_surge       = "1"
      }
    }

    template {
      metadata {
        labels = {
          app = "backend"
        }
      }

      spec {
        container {
          name  = "backend"
          image = local.resolved_backend_image

          port {
            container_port = var.backend_port
          }

          env_from {
            secret_ref {
              name = kubernetes_secret_v1.backend_env.metadata[0].name
            }
          }

          resources {
            requests = {
              cpu    = "100m"
              memory = "256Mi"
            }
            limits = {
              cpu    = "500m"
              memory = "512Mi"
            }
          }

          readiness_probe {
            http_get {
              path = "/api/health"
              port = var.backend_port
            }
            initial_delay_seconds = 15
            period_seconds        = 5
            failure_threshold     = 3
          }

          liveness_probe {
            http_get {
              path = "/api/health"
              port = var.backend_port
            }
            initial_delay_seconds = 30
            period_seconds        = 10
            failure_threshold     = 3
          }
        }

        topology_spread_constraint {
          max_skew           = 1
          topology_key       = "topology.kubernetes.io/zone"
          when_unsatisfiable = "ScheduleAnyway"
          label_selector {
            match_labels = {
              app = "backend"
            }
          }
        }
      }
    }
  }

  depends_on = [kubernetes_secret_v1.backend_env]
}

resource "kubernetes_service_v1" "backend" {
  metadata {
    name      = "backend"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
    labels = {
      app = "backend"
    }
  }

  spec {
    selector = {
      app = "backend"
    }

    port {
      name        = "http"
      port        = 80
      target_port = var.backend_port
      protocol    = "TCP"
    }

    type = "ClusterIP"
  }
}

resource "kubernetes_secret_v1" "frontend_env" {
  metadata {
    name      = "frontend-env"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
  }

  data = {
    NEXT_PUBLIC_API_BASE_URL = "http://backend.${var.apps_namespace}.svc.cluster.local"
  }

  type = "Opaque"
}

resource "kubernetes_deployment_v1" "frontend" {
  metadata {
    name      = "frontend"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
    labels = {
      app = "frontend"
    }
  }

  spec {
    replicas = var.frontend_replicas

    selector {
      match_labels = {
        app = "frontend"
      }
    }

    strategy {
      type = "RollingUpdate"
      rolling_update {
        max_unavailable = "0"
        max_surge       = "1"
      }
    }

    template {
      metadata {
        labels = {
          app = "frontend"
        }
      }

      spec {
        container {
          name  = "frontend"
          image = local.resolved_frontend_image

          port {
            container_port = 3000
          }

          env_from {
            secret_ref {
              name = kubernetes_secret_v1.frontend_env.metadata[0].name
            }
          }

          resources {
            requests = {
              cpu    = "50m"
              memory = "128Mi"
            }
            limits = {
              cpu    = "250m"
              memory = "256Mi"
            }
          }

          readiness_probe {
            http_get {
              path = "/"
              port = 3000
            }
            initial_delay_seconds = 10
            period_seconds        = 5
            failure_threshold     = 3
          }

          liveness_probe {
            http_get {
              path = "/"
              port = 3000
            }
            initial_delay_seconds = 15
            period_seconds        = 10
            failure_threshold     = 3
          }
        }

        topology_spread_constraint {
          max_skew           = 1
          topology_key       = "topology.kubernetes.io/zone"
          when_unsatisfiable = "ScheduleAnyway"
          label_selector {
            match_labels = {
              app = "frontend"
            }
          }
        }
      }
    }
  }

  depends_on = [kubernetes_service_v1.backend]
}

resource "kubernetes_service_v1" "frontend" {
  metadata {
    name      = "frontend"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
    labels = {
      app = "frontend"
    }
  }

  spec {
    selector = {
      app = "frontend"
    }

    port {
      name        = "http"
      port        = 80
      target_port = 3000
      protocol    = "TCP"
    }

    type = "ClusterIP"
  }
}
