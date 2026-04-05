import { Type, type Static } from '@sinclair/typebox';

export const AuditLogSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  table_name: Type.String(),
  record_id: Type.String(),
  action: Type.String(),
  old_value: Type.Union([Type.Any(), Type.Null()]),
  new_value: Type.Union([Type.Any(), Type.Null()]),
  performed_at: Type.String({ format: 'date-time' }),
  performed_by: Type.String(),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
});

export type AuditLog = Static<typeof AuditLogSchema>;

export const CreateAuditLogSchema = Type.Object({
  table_name: Type.String(),
  record_id: Type.String(),
  action: Type.String(),
  old_value: Type.Optional(Type.Any()),
  new_value: Type.Optional(Type.Any()),
  performed_by: Type.String(),
});

export type CreateAuditLog = Static<typeof CreateAuditLogSchema>;

export const UpdateAuditLogSchema = Type.Object({});

export type UpdateAuditLog = Static<typeof UpdateAuditLogSchema>;
