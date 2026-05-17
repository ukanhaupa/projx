import { EntityRegistry, type EntityConfig } from '../_base/index.js';
import {
  AuditLogSchema,
  CreateAuditLogSchema,
  UpdateAuditLogSchema,
} from './schemas.js';

export const auditLogConfig: EntityConfig = {
  name: 'AuditLog',
  tableName: 'audit_logs',
  prismaModel: 'AuditLog',
  apiPrefix: '/audit-logs',
  tags: ['audit-logs'],
  readonly: true,
  softDelete: false,
  bulkOperations: false,
  columnNames: [
    'id',
    'table_name',
    'record_id',
    'action',
    'old_value',
    'new_value',
    'performed_at',
    'performed_by',
    'created_at',
    'updated_at',
  ],
  searchableFields: ['table_name', 'record_id', 'performed_by', 'action'],
  schema: AuditLogSchema,
  createSchema: CreateAuditLogSchema,
  updateSchema: UpdateAuditLogSchema,
};

EntityRegistry.register(auditLogConfig);
