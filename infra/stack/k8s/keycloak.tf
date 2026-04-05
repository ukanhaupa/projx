# random_password.keycloak_db_password is unconditional — it is referenced by
# db-bootstrap.tf regardless of enable_keycloak, so the bootstrap job always
# creates the keycloak DB user (harmless when Keycloak is not deployed).
resource "random_password" "keycloak_db_password" {
  length  = 24
  special = false
}

resource "random_password" "keycloak_admin_password" {
  count   = var.enable_keycloak ? 1 : 0
  length  = 24
  special = false
}

locals {
  keycloak_groups_json_resolved = trimspace(var.keycloak_groups_json) != "" ? var.keycloak_groups_json : file(var.keycloak_groups_json_file_path)
  keycloak_users_json_resolved  = trimspace(var.keycloak_users_json) != "" ? var.keycloak_users_json : file(var.keycloak_users_json_file_path)

  keycloak_realm_json = var.enable_keycloak ? templatefile(var.keycloak_realm_template_path, {
    realm_name                   = var.keycloak_realm_name
    realm_display_name           = var.keycloak_realm_display_name
    remember_me                  = tostring(var.keycloak_remember_me)
    client_id                    = var.keycloak_client_id
    client_name                  = var.keycloak_client_name
    client_secret                = var.keycloak_client_secret
    direct_access_grants_enabled = tostring(var.keycloak_direct_access_grants_enabled)
    groups_json                  = local.keycloak_groups_json_resolved
    users_json                   = local.keycloak_users_json_resolved
  }) : ""
}

resource "aws_secretsmanager_secret" "keycloak_admin" {
  count                   = var.enable_keycloak ? 1 : 0
  name                    = "${var.name_prefix}/keycloak/admin"
  description             = "Keycloak admin credentials for ${var.environment}"
  recovery_window_in_days = 0

  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "keycloak_admin" {
  count     = var.enable_keycloak ? 1 : 0
  secret_id = aws_secretsmanager_secret.keycloak_admin[0].id
  secret_string = jsonencode({
    username = "admin"
    password = random_password.keycloak_admin_password[0].result
  })
}

resource "aws_cloudwatch_log_group" "eks_application" {
  name              = "/aws/eks/${var.eks_cluster_name}/application"
  retention_in_days = var.environment == "prod" ? 90 : 30

  tags = var.tags
}

resource "kubernetes_secret_v1" "keycloak_db" {
  count = var.enable_keycloak ? 1 : 0

  metadata {
    name      = "keycloak-db"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
  }

  data = {
    host     = var.db_host
    port     = tostring(var.db_port)
    database = var.keycloak_db_name
    username = var.keycloak_db_username
    password = random_password.keycloak_db_password.result
  }

  type = "Opaque"
}

resource "kubernetes_secret_v1" "keycloak_admin" {
  count = var.enable_keycloak ? 1 : 0

  metadata {
    name      = "keycloak-admin"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
  }

  data = {
    admin-password = random_password.keycloak_admin_password[0].result
  }

  type = "Opaque"
}

resource "kubernetes_config_map_v1" "realm_import" {
  count = var.enable_keycloak ? 1 : 0

  metadata {
    name      = "keycloak-realm-import"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
  }

  data = {
    "${var.keycloak_realm_file_name}" = local.keycloak_realm_json
  }
}

resource "helm_release" "aws_for_fluent_bit" {
  name             = "aws-for-fluent-bit"
  repository       = "https://aws.github.io/eks-charts"
  chart            = "aws-for-fluent-bit"
  version          = "0.1.35"
  namespace        = "amazon-cloudwatch"
  create_namespace = true

  values = [yamlencode({
    cloudWatch = {
      enabled          = true
      region           = var.aws_region
      logGroupName     = aws_cloudwatch_log_group.eks_application.name
      logRetentionDays = 14
    }
    firehose = {
      enabled = false
    }
    kinesis = {
      enabled = false
    }
    elasticsearch = {
      enabled = false
    }
  })]

  depends_on = [aws_cloudwatch_log_group.eks_application]
}

resource "helm_release" "keycloak" {
  count            = var.enable_keycloak ? 1 : 0
  name             = "keycloak"
  repository       = "oci://registry-1.docker.io/bitnamicharts"
  chart            = "keycloak"
  version          = var.keycloak_chart_version
  namespace        = kubernetes_namespace_v1.apps.metadata[0].name
  create_namespace = false
  timeout          = 900

  values = [yamlencode({
    global = {
      security = {
        allowInsecureImages = true
      }
      postgresql = {
        enabled = false
      }
    }

    image = {
      registry   = "docker.io"
      repository = "bitnamilegacy/keycloak"
    }

    production = var.environment == "prod"

    auth = {
      adminUser         = "admin"
      existingSecret    = kubernetes_secret_v1.keycloak_admin[0].metadata[0].name
      passwordSecretKey = "admin-password"
    }

    externalDatabase = {
      existingSecret            = kubernetes_secret_v1.keycloak_db[0].metadata[0].name
      existingSecretHostKey     = "host"
      existingSecretPortKey     = "port"
      existingSecretUserKey     = "username"
      existingSecretPasswordKey = "password"
      existingSecretDatabaseKey = "database"
    }

    postgresql = {
      enabled = false
    }

    service = {
      type = "ClusterIP"
      port = 80
    }

    proxyHeaders = "xforwarded"

    readinessProbe = {
      enabled = false
    }

    livenessProbe = {
      enabled = false
    }

    customReadinessProbe = {
      httpGet = {
        path = "/auth/realms/master/.well-known/openid-configuration"
        port = "http"
      }
      initialDelaySeconds = 120
      periodSeconds       = 10
      timeoutSeconds      = 1
      failureThreshold    = 3
      successThreshold    = 1
    }

    customLivenessProbe = {
      httpGet = {
        path = "/auth/realms/master/.well-known/openid-configuration"
        port = "http"
      }
      initialDelaySeconds = 900
      periodSeconds       = 10
      timeoutSeconds      = 1
      failureThreshold    = 3
      successThreshold    = 1
    }

    extraEnvVars = [
      {
        name  = "KC_HTTP_RELATIVE_PATH"
        value = "/auth"
      },
      {
        name  = "KC_PROXY_HEADERS"
        value = "xforwarded"
      },
      {
        name  = "KC_HOSTNAME_STRICT"
        value = "false"
      },
      {
        name  = "KC_HOSTNAME_STRICT_HTTPS"
        value = "false"
      }
    ]

    keycloakConfigCli = {
      enabled = var.enable_realm_bootstrap
      image = {
        registry   = "docker.io"
        repository = "bitnamilegacy/keycloak-config-cli"
      }

      extraEnvVars = [
        {
          name  = "KEYCLOAK_URL"
          value = "http://keycloak-headless:8080/auth"
        }
      ]

      configuration = {
        "${var.keycloak_realm_file_name}" = local.keycloak_realm_json
      }
    }

    metrics = {
      enabled = true
    }
  })]

  depends_on = [
    kubernetes_job_v1.keycloak_db_bootstrap,
    kubernetes_secret_v1.keycloak_db,
    kubernetes_secret_v1.keycloak_admin,
    helm_release.aws_for_fluent_bit
  ]
}
