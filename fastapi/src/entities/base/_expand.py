from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from ._model import Base, BaseModel_
from ._repository import BaseRepository


@dataclass(frozen=True)
class ExpandInfo:
    fk_column: str
    target_model: type[BaseModel_]


class ExpandResolver:
    _table_model_map: dict[str, type[BaseModel_]] | None = None
    _expand_cache: dict[type, dict[str, ExpandInfo]] = {}

    # ── Table-name → Model-class registry ────────────────────────────────

    @classmethod
    def _get_table_model_map(cls) -> dict[str, type[BaseModel_]]:
        if cls._table_model_map is None:
            cls._table_model_map = {}
            for mapper in Base.registry.mappers:
                model_cls = mapper.class_
                if hasattr(model_cls, "__tablename__") and hasattr(model_cls, "__table__"):
                    cls._table_model_map[model_cls.__tablename__] = model_cls
        return cls._table_model_map

    # ── FK introspection ─────────────────────────────────────────────────

    @classmethod
    def get_expandable_fields(cls, model: type[BaseModel_]) -> dict[str, ExpandInfo]:
        if model in cls._expand_cache:
            return cls._expand_cache[model]

        table_map = cls._get_table_model_map()
        fields: dict[str, ExpandInfo] = {}

        for col in model.__table__.columns:
            if not col.foreign_keys or not col.key.endswith("_id"):
                continue
            fk = next(iter(col.foreign_keys))
            target_table = fk.column.table.name
            target_model = table_map.get(target_table)
            if target_model is None:
                continue
            expand_name = col.key[:-3]  # strip "_id"
            fields[expand_name] = ExpandInfo(fk_column=col.key, target_model=target_model)

        cls._expand_cache[model] = fields
        return fields

    # ── Parsing ──────────────────────────────────────────────────────────

    @staticmethod
    def parse(raw: str) -> list[str]:
        if not raw:
            return []
        return [f.strip() for f in raw.split(",") if f.strip()]

    # ── Batch resolver ───────────────────────────────────────────────────

    @classmethod
    async def resolve(
        cls,
        items: list,
        expand_fields: list[str],
        source_model: type[BaseModel_],
    ) -> list[dict]:
        if not items:
            return []

        # Convert to dicts (respects __hidden_fields__ via __iter__)
        dicts = [dict(item) if not isinstance(item, dict) else item for item in items]

        if not expand_fields:
            return dicts

        expandable = cls.get_expandable_fields(source_model)
        valid = {name: info for name, info in expandable.items() if name in expand_fields}

        if not valid:
            return dicts

        # Collect FK IDs per target model (deduplicated)
        ids_by_model: dict[type[BaseModel_], set[int]] = defaultdict(set)
        for item in items:
            for info in valid.values():
                val = getattr(item, info.fk_column, None) if not isinstance(item, dict) else item.get(info.fk_column)
                if val is not None:
                    ids_by_model[info.target_model].add(int(val))

        # One batch query per target model
        cache: dict[type[BaseModel_], dict[int, dict]] = {}
        for target_model, ids in ids_by_model.items():
            repo = BaseRepository(target_model)
            rows = await repo.get_by_ids(list(ids))
            cache[target_model] = {row.id: dict(row) for row in rows}

        # Inject expanded objects
        for d, item in zip(dicts, items, strict=True):
            for name, info in valid.items():
                val = getattr(item, info.fk_column, None) if not isinstance(item, dict) else d.get(info.fk_column)
                if val is not None:
                    d[name] = cache.get(info.target_model, {}).get(int(val))
                else:
                    d[name] = None

        return dicts
