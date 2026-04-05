resource "kubernetes_horizontal_pod_autoscaler_v2" "backend" {
  metadata {
    name      = "backend"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
  }

  spec {
    scale_target_ref {
      api_version = "apps/v1"
      kind        = "Deployment"
      name        = kubernetes_deployment_v1.backend.metadata[0].name
    }

    min_replicas = var.backend_replicas
    max_replicas = var.backend_replicas * 3

    metric {
      type = "Resource"
      resource {
        name = "cpu"
        target {
          type                = "Utilization"
          average_utilization = 70
        }
      }
    }

    metric {
      type = "Resource"
      resource {
        name = "memory"
        target {
          type                = "Utilization"
          average_utilization = 80
        }
      }
    }

    behavior {
      scale_up {
        stabilization_window_seconds = 60
        policy {
          type           = "Pods"
          value          = 2
          period_seconds = 60
        }
      }
      scale_down {
        stabilization_window_seconds = 300
        policy {
          type           = "Pods"
          value          = 1
          period_seconds = 120
        }
      }
    }
  }
}

resource "kubernetes_horizontal_pod_autoscaler_v2" "frontend" {
  metadata {
    name      = "frontend"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
  }

  spec {
    scale_target_ref {
      api_version = "apps/v1"
      kind        = "Deployment"
      name        = kubernetes_deployment_v1.frontend.metadata[0].name
    }

    min_replicas = var.frontend_replicas
    max_replicas = var.frontend_replicas * 3

    metric {
      type = "Resource"
      resource {
        name = "cpu"
        target {
          type                = "Utilization"
          average_utilization = 70
        }
      }
    }

    behavior {
      scale_up {
        stabilization_window_seconds = 60
        policy {
          type           = "Pods"
          value          = 2
          period_seconds = 60
        }
      }
      scale_down {
        stabilization_window_seconds = 300
        policy {
          type           = "Pods"
          value          = 1
          period_seconds = 120
        }
      }
    }
  }
}

resource "kubernetes_pod_disruption_budget_v1" "backend" {
  metadata {
    name      = "backend"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
  }

  spec {
    min_available = "1"

    selector {
      match_labels = {
        app = "backend"
      }
    }
  }
}

resource "kubernetes_pod_disruption_budget_v1" "frontend" {
  metadata {
    name      = "frontend"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
  }

  spec {
    min_available = "1"

    selector {
      match_labels = {
        app = "frontend"
      }
    }
  }
}

resource "kubernetes_network_policy_v1" "backend" {
  metadata {
    name      = "backend-policy"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
  }

  spec {
    pod_selector {
      match_labels = {
        app = "backend"
      }
    }

    policy_types = ["Ingress"]

    ingress {
      from {
        namespace_selector {
          match_labels = {
            "kubernetes.io/metadata.name" = kubernetes_namespace_v1.apps.metadata[0].name
          }
        }
      }

      from {
        namespace_selector {
          match_labels = {
            "kubernetes.io/metadata.name" = "kube-system"
          }
        }
      }

      ports {
        port     = var.backend_port
        protocol = "TCP"
      }
    }
  }
}
