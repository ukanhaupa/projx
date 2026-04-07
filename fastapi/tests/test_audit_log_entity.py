from src.entities.audit_log import AuditLog
from tests.base_entity_api_test import BaseEntityApiTest


class TestAuditLogEntity(BaseEntityApiTest):
    __test__ = True
    endpoint = "/api/v1/audit-logs/"
    create_payload = {
        "table_name": "tests",
        "record_id": 1,
        "action": "INSERT",
        "old_value": None,
        "new_value": {"id": 1},
        "performed_by": "system",
        "performed_at": "2026-01-01T00:00:00",
    }
    update_payload = {"performed_by": "admin"}
    invalid_payload = {}
    filter_field = "performed_by"
    filter_value = "alice"
    other_filter_value = "bob"

    allow_create = False
    allow_update = False
    allow_delete = False
    method_not_allowed_status = 405  # FastAPI returns 405 when path exists but method doesn't

    def make_model(self, index: int, **overrides):
        data = {
            "table_name": "tests",
            "record_id": index,
            "action": "INSERT",
            "old_value": None,
            "new_value": {"id": index},
            "performed_by": "system",
        }
        data.update(overrides)
        return AuditLog(**data)

    def build_update_payload(self, row):
        return {
            "table_name": row.table_name,
            "record_id": row.record_id,
            "action": row.action,
            "old_value": row.old_value,
            "new_value": row.new_value,
            "performed_by": "admin",
            "performed_at": row.performed_at.isoformat(),
        }
