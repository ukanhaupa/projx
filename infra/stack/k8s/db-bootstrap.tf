resource "kubernetes_secret_v1" "db_master_bootstrap" {
  metadata {
    name      = "db-master-bootstrap"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
  }

  data = {
    host              = var.db_host
    port              = tostring(var.db_port)
    master_db         = var.db_master_database
    master_user       = var.db_master_user
    master_pass       = var.db_master_password
    keycloak_db       = var.keycloak_db_name
    keycloak_user     = var.keycloak_db_username
    keycloak_password = random_password.keycloak_db_password.result
    backend_db        = var.backend_db_name
    backend_user      = var.backend_db_username
    backend_pass      = var.backend_db_password
    reader_user       = var.db_reader_username
    reader_pass       = var.db_reader_password
  }

  type = "Opaque"
}

resource "kubernetes_job_v1" "keycloak_db_bootstrap" {
  metadata {
    name      = "keycloak-db-bootstrap"
    namespace = kubernetes_namespace_v1.apps.metadata[0].name
  }

  spec {
    backoff_limit = 6

    template {
      metadata {
        labels = {
          app = "keycloak-db-bootstrap"
        }
      }

      spec {
        restart_policy = "OnFailure"

        container {
          name  = "bootstrap"
          image = "postgres:16"

          env {
            name = "HOST"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.db_master_bootstrap.metadata[0].name
                key  = "host"
              }
            }
          }

          env {
            name = "PORT"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.db_master_bootstrap.metadata[0].name
                key  = "port"
              }
            }
          }

          env {
            name = "MASTER_DB"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.db_master_bootstrap.metadata[0].name
                key  = "master_db"
              }
            }
          }

          env {
            name = "MASTER_USER"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.db_master_bootstrap.metadata[0].name
                key  = "master_user"
              }
            }
          }

          env {
            name = "MASTER_PASS"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.db_master_bootstrap.metadata[0].name
                key  = "master_pass"
              }
            }
          }

          env {
            name = "KEYCLOAK_DB"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.db_master_bootstrap.metadata[0].name
                key  = "keycloak_db"
              }
            }
          }

          env {
            name = "KEYCLOAK_USER"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.db_master_bootstrap.metadata[0].name
                key  = "keycloak_user"
              }
            }
          }

          env {
            name = "KEYCLOAK_PASSWORD"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.db_master_bootstrap.metadata[0].name
                key  = "keycloak_password"
              }
            }
          }

          env {
            name = "READER_USER"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.db_master_bootstrap.metadata[0].name
                key  = "reader_user"
              }
            }
          }

          env {
            name = "READER_PASSWORD"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.db_master_bootstrap.metadata[0].name
                key  = "reader_pass"
              }
            }
          }

          env {
            name = "BACKEND_DB"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.db_master_bootstrap.metadata[0].name
                key  = "backend_db"
              }
            }
          }

          env {
            name = "BACKEND_USER"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.db_master_bootstrap.metadata[0].name
                key  = "backend_user"
              }
            }
          }

          env {
            name = "BACKEND_PASSWORD"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.db_master_bootstrap.metadata[0].name
                key  = "backend_pass"
              }
            }
          }

          command = ["/bin/sh", "-c"]
          args = [<<-EOT
            set -e
            export PGPASSWORD="$MASTER_PASS"

            until pg_isready -h "$HOST" -p "$PORT" -U "$MASTER_USER" -d "$MASTER_DB"; do
              echo "waiting for postgres..."
              sleep 5
            done

            psql -h "$HOST" -p "$PORT" -U "$MASTER_USER" -d "$MASTER_DB" -v ON_ERROR_STOP=1 -v MASTER_USER="$MASTER_USER" -v KEYCLOAK_USER="$KEYCLOAK_USER" -v KEYCLOAK_PASSWORD="$KEYCLOAK_PASSWORD" -v KEYCLOAK_DB="$KEYCLOAK_DB" -v READER_USER="$READER_USER" -v READER_PASSWORD="$READER_PASSWORD" -v BACKEND_DB="$BACKEND_DB" -v BACKEND_USER="$BACKEND_USER" -v BACKEND_PASSWORD="$BACKEND_PASSWORD" <<'SQL'
            SELECT CASE
              WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'KEYCLOAK_USER')
              THEN format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'KEYCLOAK_USER', :'KEYCLOAK_PASSWORD')
              ELSE format('CREATE ROLE %I LOGIN PASSWORD %L', :'KEYCLOAK_USER', :'KEYCLOAK_PASSWORD')
            END\gexec

            SELECT CASE
              WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'BACKEND_USER')
              THEN format('ALTER ROLE %I WITH LOGIN PASSWORD %L CREATEDB', :'BACKEND_USER', :'BACKEND_PASSWORD')
              ELSE format('CREATE ROLE %I LOGIN PASSWORD %L CREATEDB', :'BACKEND_USER', :'BACKEND_PASSWORD')
            END\gexec

            SELECT CASE
              WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'READER_USER')
              THEN format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'READER_USER', :'READER_PASSWORD')
              ELSE format('CREATE ROLE %I LOGIN PASSWORD %L', :'READER_USER', :'READER_PASSWORD')
            END\gexec

            SELECT format('CREATE DATABASE %I OWNER %I', :'KEYCLOAK_DB', :'KEYCLOAK_USER')
            WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'KEYCLOAK_DB')\gexec

            SELECT format('CREATE DATABASE %I OWNER %I', :'BACKEND_DB', :'BACKEND_USER')
            WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'BACKEND_DB')\gexec

            SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'KEYCLOAK_DB', :'READER_USER')\gexec
            SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'BACKEND_DB', :'READER_USER')\gexec

            \connect :BACKEND_DB

            -- Ensure the backend DB user has full privileges on the public schema
            SELECT format('GRANT ALL PRIVILEGES ON SCHEMA public TO %I', :'BACKEND_USER')\gexec
            SELECT format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %I', :'BACKEND_USER')\gexec
            SELECT format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO %I', :'BACKEND_USER')\gexec

            -- Reader privileges on existing objects
            SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'READER_USER')\gexec
            SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', :'READER_USER')\gexec
            SELECT format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'READER_USER')\gexec

            -- Allow master user to act as backend user so it can set future-table defaults
            SELECT format('GRANT %I TO %I', :'BACKEND_USER', :'MASTER_USER')\gexec
            SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO %I', :'BACKEND_USER', :'READER_USER')\gexec
            SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON SEQUENCES TO %I', :'BACKEND_USER', :'READER_USER')\gexec
            SELECT format('REVOKE %I FROM %I', :'BACKEND_USER', :'MASTER_USER')\gexec
            SQL
          EOT
          ]
        }
      }
    }
  }

  wait_for_completion = true

  depends_on = [kubernetes_secret_v1.db_master_bootstrap]
}
