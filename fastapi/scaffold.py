import argparse
import importlib
import os
import re
import sys

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import types as sa_types

_BASE_FIELDS = {"id", "created_at", "updated_at", "deleted_at"}

_FAKE_VALUES = {
    "str": lambda name, i: f'"{name}_{i}"',
    "int": lambda name, i: str(i),
    "float": lambda name, i: f"{i}.5",
    "bool": lambda name, i: "True",
    "date": lambda name, i: f'"2026-01-0{min(i, 9)}"',
    "datetime": lambda name, i: f'"2026-01-0{min(i, 9)}T00:00:00"',
    "dict": lambda name, i: f'{{"key": "val_{i}"}}',
}

_TYPE_MAP = [
    (sa_types.Boolean, "bool"),
    (sa_types.BigInteger, "int"),
    (sa_types.Integer, "int"),
    (sa_types.Numeric, "float"),
    (sa_types.DateTime, "datetime"),
    (sa_types.Date, "date"),
    (sa_types.JSON, "dict"),
    (sa_types.Text, "str"),
    (sa_types.String, "str"),
]


def _to_class_name(entity_name: str) -> str:
    return "".join(w.capitalize() for w in entity_name.split("_"))


def _to_table_name(entity_name: str) -> str:
    return entity_name + "s" if not entity_name.endswith("s") else entity_name


def resolve_type(col_type) -> str:
    for sa_cls, py_type in _TYPE_MAP:
        if isinstance(col_type, sa_cls):
            return py_type
    return "str"


def fake(py_type: str, field_name: str, index: int) -> str:
    fn = _FAKE_VALUES.get(py_type, lambda n, i: f'"{n}_{i}"')
    return fn(field_name, index)


def introspect(entity_name: str):
    class_name = _to_class_name(entity_name)
    try:
        module = importlib.import_module(f"src.entities.{entity_name}._model")
    except (ImportError, ModuleNotFoundError) as e:
        print(f"ERROR: Failed to import src.entities.{entity_name}._model: {e}")
        sys.exit(1)

    model_cls = getattr(module, class_name, None)
    if not model_cls:
        print(f"ERROR: No class '{class_name}' found in src/entities/{entity_name}/_model.py")
        sys.exit(1)

    mapper = sa_inspect(model_cls)
    fields = {}
    for col in mapper.columns:
        if col.key in _BASE_FIELDS:
            continue
        fields[col.key] = {
            "type": resolve_type(col.type),
            "nullable": bool(col.nullable),
            "unique": bool(col.unique),
        }

    table_name = model_cls.__tablename__
    readonly = getattr(model_cls, "__readonly__", False)
    return class_name, table_name, fields, readonly


def generate_model(entity_name: str):
    class_name = _to_class_name(entity_name)
    table_name = _to_table_name(entity_name)

    content = f'''from sqlalchemy import Column, String, Text

from ..base._model import BaseModel_


class {class_name}(BaseModel_):
    __tablename__ = "{table_name}"
    __searchable_fields__ = {{"name"}}

    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
'''
    return content


def generate_test(entity_name: str, class_name: str, table_name: str, fields: dict, readonly: bool):
    route_prefix = table_name.replace("_", "-")
    endpoint = f"/api/v1/{route_prefix}/"

    filter_field = None
    for fname, info in fields.items():
        if info["type"] == "str" and not info["unique"]:
            filter_field = fname
            break
    if not filter_field:
        filter_field = next(iter(fields), "id")

    create_lines = []
    for fname, info in fields.items():
        create_lines.append(f'        "{fname}": {fake(info["type"], fname, 1)},')

    update_field = next((f for f, i in fields.items() if not i["nullable"]), next(iter(fields), "id"))
    update_val = fake(fields[update_field]["type"], f"updated_{update_field}", 1)

    model_lines = []
    for fname, info in fields.items():
        if info["type"] == "str":
            model_lines.append(f'            "{fname}": f"{fname}_{{index}}",')
        elif info["type"] == "int":
            model_lines.append(f'            "{fname}": index,')
        elif info["type"] == "float":
            model_lines.append(f'            "{fname}": index + 0.5,')
        elif info["type"] == "bool":
            model_lines.append(f'            "{fname}": True,')
        elif info["type"] == "datetime":
            model_lines.append(f'            "{fname}": datetime(2026, 1, 1),')
        elif info["type"] == "date":
            model_lines.append(f'            "{fname}": date(2026, 1, 1),')
        elif info["type"] == "dict":
            model_lines.append(f'            "{fname}": {{"key": f"val_{{index}}"}},')
        else:
            model_lines.append(f'            "{fname}": f"{fname}_{{index}}",')

    filter_type = fields.get(filter_field, {}).get("type", "str")

    readonly_flags = ""
    if readonly:
        readonly_flags = """
    allow_create = False
    allow_update = False
    allow_delete = False
    method_not_allowed_status = 405
"""

    has_date = any(i["type"] in ("date", "datetime") for i in fields.values())
    date_import = "from datetime import date, datetime\n\n" if has_date else ""

    content = f'''{date_import}from src.entities.{entity_name}._model import {class_name}
from tests.base_entity_api_test import BaseEntityApiTest


class Test{class_name}Entity(BaseEntityApiTest):

    __test__ = True
    endpoint = "{endpoint}"
    create_payload = {{
{chr(10).join(create_lines)}
    }}
    update_payload = {{"{update_field}": {update_val}}}
    invalid_payload = {{}}
    filter_field = "{filter_field}"
    filter_value = {fake(filter_type, f"filter_{filter_field}", 1)}
    other_filter_value = {fake(filter_type, f"filter_{filter_field}", 2)}
{readonly_flags}
    def make_model(self, index: int, **overrides):
        data = {{
{chr(10).join(model_lines)}
        }}
        data.update(overrides)
        return {class_name}(**data)
'''
    return content


def generate_controller(entity_name: str, class_name: str):
    content = f"""from fastapi import Body, Query, Request

from ..base import BaseController, BaseRepository, BaseService
from ._model import {class_name}


class {class_name}Repository(BaseRepository):
    def __init__(self):
        super().__init__({class_name})


class {class_name}Service(BaseService):
    def __init__(self):
        super().__init__({class_name}Repository)


class {class_name}Controller(BaseController):
    def __init__(self):
        super().__init__({class_name}Service)
"""
    return content


def _validate_entity_name(name: str) -> bool:
    return bool(re.match(r"^[a-z][a-z0-9_]*$", name))


def main():
    parser = argparse.ArgumentParser(description="Scaffold entity files for the auto-entity system")
    parser.add_argument("entity", help="Entity directory name (e.g. my_entity)")
    parser.add_argument(
        "--controller",
        action="store_true",
        help="Also generate a custom controller skeleton",
    )
    parser.add_argument(
        "--model",
        action="store_true",
        help="Also generate a starter _model.py (use when creating a new entity from scratch)",
    )
    args = parser.parse_args()

    entity_name = args.entity

    if not _validate_entity_name(entity_name):
        print(f"ERROR: Entity name must be lowercase snake_case (got '{entity_name}')")
        sys.exit(1)

    entity_dir = f"src/entities/{entity_name}"
    model_path = f"{entity_dir}/_model.py"

    if args.model:
        os.makedirs(entity_dir, exist_ok=True)
        if os.path.exists(model_path):
            print(f"SKIP: {model_path} already exists")
        else:
            with open(model_path, "w") as f:
                f.write(generate_model(entity_name))
            print(f"CREATED: {model_path}")
        print("\nNext steps:")
        print(f"  1. Edit {model_path} to add your columns")
        print(f"  2. Run: uv run scaffold.py {entity_name}  (to generate tests)")
        print("  3. Run: uv run migrate.py  (to create the migration)")
        return

    if not os.path.exists(model_path):
        print(f"ERROR: {model_path} not found")
        print("\nTo create a new entity from scratch:")
        print(f"  uv run scaffold.py {entity_name} --model")
        sys.exit(1)

    class_name, table_name, fields, readonly = introspect(entity_name)
    print(f"Introspected {class_name}: {len(fields)} fields, readonly={readonly}")

    test_path = f"tests/test_{entity_name}_entity.py"
    if os.path.exists(test_path):
        print(f"SKIP: {test_path} already exists")
    else:
        with open(test_path, "w") as f:
            f.write(generate_test(entity_name, class_name, table_name, fields, readonly))
        print(f"CREATED: {test_path}")

    if args.controller:
        ctrl_path = f"{entity_dir}/_controller.py"
        if os.path.exists(ctrl_path):
            print(f"SKIP: {ctrl_path} already exists")
        else:
            with open(ctrl_path, "w") as f:
                f.write(generate_controller(entity_name, class_name))
            print(f"CREATED: {ctrl_path}")


if __name__ == "__main__":
    main()
