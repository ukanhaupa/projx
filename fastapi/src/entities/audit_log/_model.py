import datetime
import decimal

from sqlalchemy import JSON, BigInteger, Column, DateTime, String, event, func, inspect
from sqlalchemy.orm import Session

from ..base._model import BaseModel_


class AuditLog(BaseModel_):
    __tablename__ = "audit_logs"
    __readonly__ = True
    __api_prefix__ = "/audit-logs"
    __searchable_fields__ = {"table_name", "record_id", "performed_by", "action"}

    table_name = Column(String(255), nullable=False, index=True)
    record_id = Column(BigInteger, nullable=False, index=True)
    action = Column(String(64), nullable=False)
    old_value = Column(JSON, nullable=True)
    new_value = Column(JSON, nullable=True)
    performed_at = Column(DateTime, server_default=func.now(), nullable=False)
    performed_by = Column(String(255), nullable=False)


# AUDIT LOG LISTENERS


def _to_json_safe(value):
    """Convert SQLAlchemy values into JSON-serializable form."""
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (list, tuple)):
        return [_to_json_safe(v) for v in value]
    if isinstance(value, dict):
        return {k: _to_json_safe(v) for k, v in value.items()}
    return value


def _serialize(obj):
    """Turn SQLAlchemy model into JSON-safe dict without internals or relationships."""
    # Only serialize column attributes, not relationships
    insp = inspect(obj)
    return {attr.key: _to_json_safe(getattr(obj, attr.key)) for attr in insp.mapper.column_attrs}


def _get_pk(obj):
    """Return primary key value(s) for any SQLAlchemy model."""
    insp = inspect(obj)

    # If identity is already populated
    if insp.identity:
        return insp.identity[0] if len(insp.identity) == 1 else insp.identity

    # Fallback: read PK attributes directly
    pk_attrs = insp.mapper.primary_key
    values = [getattr(obj, col.name, None) for col in pk_attrs]
    if all(v is not None for v in values):
        return values[0] if len(values) == 1 else tuple(values)

    raise ValueError(f"Could not resolve primary key for {obj}")


def _skip(obj):
    """Skip auditing for AuditLog itself or ignored models."""
    return isinstance(obj, AuditLog) or getattr(obj, "__audit_ignore__", False)


# BEFORE FLUSH → UPDATE + DELETE
@event.listens_for(Session, "before_flush")
def audit_before_flush(session, flush_context, instances):
    user = session.info.get("user", "system")

    # UPDATE
    for obj in session.dirty:
        if _skip(obj):
            continue
        if not session.is_modified(obj, include_collections=False):
            continue

        old_values = {
            attr.key: _to_json_safe(attr.history.deleted[0]) for attr in inspect(obj).attrs if attr.history.deleted
        }
        new_values = _serialize(obj)

        session.add(
            AuditLog(
                table_name=obj.__tablename__,
                record_id=_get_pk(obj),
                action="UPDATE",
                old_value=old_values,
                new_value=new_values,
                performed_by=user,
            )
        )

    # DELETE
    for obj in session.deleted:
        if _skip(obj):
            continue
        session.add(
            AuditLog(
                table_name=obj.__tablename__,
                record_id=_get_pk(obj),
                action="DELETE",
                old_value=_serialize(obj),
                new_value=None,
                performed_by=user,
            )
        )


# AFTER FLUSH → INSERT
@event.listens_for(Session, "after_flush")
def audit_after_flush(session, flush_context):
    user = session.info.get("user", "system")

    for obj in session.new:
        if _skip(obj):
            continue

        # Ensure PK is loaded
        pk = _get_pk(obj)

        session.add(
            AuditLog(
                table_name=obj.__tablename__,
                record_id=pk,
                action="INSERT",
                old_value=None,
                new_value=_serialize(obj),
                performed_by=user,
            )
        )
