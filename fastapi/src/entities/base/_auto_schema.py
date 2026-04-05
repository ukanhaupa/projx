from __future__ import annotations

import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, create_model
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import types as sa_types

from ._model import BaseModel_

# Fields that are always auto-managed and excluded from create/update schemas
_AUTO_FIELDS = {"id", "created_at", "updated_at", "deleted_at"}

# SQLAlchemy type → Python type mapping
_TYPE_MAP: list[tuple[type, type]] = [
    (sa_types.Boolean, bool),
    (sa_types.BigInteger, int),
    (sa_types.Integer, int),
    (sa_types.Numeric, float),
    (sa_types.DateTime, datetime.datetime),
    (sa_types.Date, datetime.date),
    (sa_types.Time, datetime.time),
    (sa_types.JSON, dict[str, Any]),
    (sa_types.Text, str),
    (sa_types.String, str),
    (sa_types.Enum, str),
]


def _resolve_python_type(col_type) -> type:
    for sa_cls, py_type in _TYPE_MAP:
        if isinstance(col_type, sa_cls):
            return py_type
    return str


def _resolve_field_meta(col_type) -> dict | None:
    """Return extra metadata for frontend field-type hints."""
    if isinstance(col_type, sa_types.Enum):
        enums = col_type.enums if hasattr(col_type, "enums") else []
        return {"field_type": "select", "options": list(enums)}
    if isinstance(col_type, sa_types.Boolean):
        return {"field_type": "boolean"}
    if isinstance(col_type, sa_types.Text):
        return {"field_type": "textarea"}
    if isinstance(col_type, sa_types.Date):
        return {"field_type": "date"}
    if isinstance(col_type, sa_types.DateTime):
        return {"field_type": "datetime"}
    if isinstance(col_type, sa_types.JSON):
        return {"field_type": "textarea"}
    if isinstance(col_type, (sa_types.Integer, sa_types.BigInteger, sa_types.Numeric)):
        return {"field_type": "number"}
    return {"field_type": "text"}


# ── Schema cache ─────────────────────────────────────────────────────────
_schema_cache: dict[str, type[BaseModel]] = {}


def create_schema(
    model: type[BaseModel_],
    *,
    name_suffix: str = "Schema",
    include_fields: set[str] | None = None,
    exclude_fields: set[str] | None = None,
    all_optional: bool = False,
) -> type[BaseModel]:
    """Create a Pydantic model from a SQLAlchemy model's columns."""
    cache_key = f"{model.__name__}_{name_suffix}_{'opt' if all_optional else 'req'}"
    if cache_key in _schema_cache:
        return _schema_cache[cache_key]

    exclude = exclude_fields or set()
    mapper = sa_inspect(model)
    fields: dict[str, Any] = {}

    for col in mapper.columns:
        if col.key in exclude:
            continue
        if include_fields and col.key not in include_fields:
            continue

        py_type = _resolve_python_type(col.type)

        if all_optional or col.nullable or col.default is not None or col.server_default is not None:
            fields[col.key] = (Optional[py_type], None)
        else:
            fields[col.key] = (py_type, ...)

    schema = create_model(
        f"{model.__name__}{name_suffix}",
        **fields,
    )
    schema.model_config = ConfigDict(extra="forbid")

    _schema_cache[cache_key] = schema
    return schema


def create_create_schema(model: type[BaseModel_]) -> type[BaseModel]:
    """Schema for POST — excludes auto fields, respects __create_fields__."""
    include = getattr(model, "__create_fields__", None)
    return create_schema(
        model,
        name_suffix="Create",
        exclude_fields=_AUTO_FIELDS,
        include_fields=include,
        all_optional=False,
    )


def create_update_schema(model: type[BaseModel_]) -> type[BaseModel]:
    """Schema for PATCH — all fields optional, excludes auto fields."""
    include = getattr(model, "__update_fields__", None)
    return create_schema(
        model,
        name_suffix="Update",
        exclude_fields=_AUTO_FIELDS,
        include_fields=include,
        all_optional=True,
    )


def get_field_metadata(model: type[BaseModel_]) -> list[dict]:
    """Return field metadata for the /api/v1/_meta endpoint.

    This gives the frontend everything it needs to render forms and tables.
    """
    mapper = sa_inspect(model)
    hidden = getattr(model, "__hidden_fields__", set())
    searchable = set(getattr(model, "__searchable_fields__", set()))
    create_fields = getattr(model, "__create_fields__", None)
    update_fields = getattr(model, "__update_fields__", None)
    result = []

    for col in mapper.columns:
        if col.key in hidden:
            continue

        py_type = _resolve_python_type(col.type)
        meta = _resolve_field_meta(col.type) or {}
        is_auto = col.key in _AUTO_FIELDS

        in_create = not is_auto and (create_fields is None or col.key in create_fields)
        in_update = not is_auto and (update_fields is None or col.key in update_fields)

        entry = {
            "key": col.key,
            "label": col.key.replace("_", " ").title(),
            "type": py_type.__name__,
            "nullable": bool(col.nullable),
            "is_auto": is_auto,
            "is_primary_key": bool(col.primary_key),
            "filterable": not isinstance(col.type, (sa_types.JSON, sa_types.Text)),
            "searchable": col.key in searchable,
            "in_create": in_create,
            "in_update": in_update,
            "has_foreign_key": bool(col.foreign_keys),
            **meta,
        }

        if isinstance(col.type, sa_types.String) and col.type.length:
            entry["max_length"] = col.type.length

        if col.foreign_keys:
            fk = next(iter(col.foreign_keys))
            entry["foreign_key_target"] = fk.column.table.name

        result.append(entry)

    return result
