import { z } from 'zod';

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  table_name: z.string(),
  record_id: z.string(),
  action: z.string(),
  old_value: z.unknown().nullable(),
  new_value: z.unknown().nullable(),
  performed_at: z.string().datetime(),
  performed_by: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type AuditLog = z.infer<typeof AuditLogSchema>;

export const CreateAuditLogSchema = z.object({
  table_name: z.string(),
  record_id: z.string(),
  action: z.string(),
  old_value: z.unknown().optional(),
  new_value: z.unknown().optional(),
  performed_by: z.string(),
});

export type CreateAuditLog = z.infer<typeof CreateAuditLogSchema>;

export const UpdateAuditLogSchema = z.object({});

export type UpdateAuditLog = z.infer<typeof UpdateAuditLogSchema>;
