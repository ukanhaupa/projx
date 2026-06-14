ALTER TABLE admin_panel.write_audit_log
  DROP CONSTRAINT IF EXISTS write_audit_log_action_check;

ALTER TABLE admin_panel.write_audit_log
  ADD CONSTRAINT write_audit_log_action_check
  CHECK (action IN ('insert', 'update', 'delete', 'decrypt'));
