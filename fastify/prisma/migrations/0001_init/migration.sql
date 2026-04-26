-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "table_name" VARCHAR(255) NOT NULL,
    "record_id" VARCHAR(255) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performed_by" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_table_name_idx" ON "audit_logs" ("table_name");

-- CreateIndex
CREATE INDEX "audit_logs_record_id_idx" ON "audit_logs" ("record_id");

-- CreateTable
CREATE TABLE "service_configs" (
    "id" TEXT NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "config" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_configs_purpose_key" ON "service_configs" ("purpose");
