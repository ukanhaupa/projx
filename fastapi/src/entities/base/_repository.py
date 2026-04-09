from __future__ import annotations

import builtins
from contextlib import asynccontextmanager
from datetime import UTC
from typing import TYPE_CHECKING, Any, TypeVar

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Integer,
    Numeric,
    String,
    Text,
    and_,
    asc,
    cast,
    desc,
    func,
    or_,
)
from sqlalchemy.future import select

from src.configs import DatabaseConfig

from ._model import BaseModel_, NotFoundError

if TYPE_CHECKING:
    from sqlalchemy.sql import Select

ModelT = TypeVar("ModelT", bound=BaseModel_)

_FILTER_SUFFIXES = ("__in", "__isnull", "__gte", "__lte", "__gt", "__lt")


class BaseRepository:
    def __init__(self, model: type[ModelT]):
        self.model = model
        self._soft_delete = getattr(model, "__soft_delete__", False)
        if self._soft_delete and not hasattr(model, "deleted_at"):
            raise ValueError(
                f"{model.__name__} has __soft_delete__=True but no 'deleted_at' column. "
                f"Apply SoftDeleteMixin to the model."
            )
        self._column_names: set[str] | None = None

    def _get_column_names(self) -> set[str]:
        if self._column_names is None:
            self._column_names = {c.key for c in self.model.__table__.columns}
        return self._column_names

    def _is_suffixed_filter(self, key: str) -> bool:
        return any(key.endswith(s) for s in _FILTER_SUFFIXES)

    def _prepare_filter_by(self, filter_by: dict[str, Any] | None) -> dict[str, Any]:
        column_names = self._get_column_names()
        sanitized = {}
        for k, v in (filter_by or {}).items():
            if self._is_suffixed_filter(k):
                continue
            if k not in column_names:
                continue
            if "," in str(v):
                continue
            if isinstance(self.model.__table__.columns[k].type, JSON):
                continue
            sanitized[k] = v
        return self._convert_filter_values(sanitized)

    def _prepare_advanced_filters(self, filter_by: dict[str, Any] | None) -> list[Any]:
        column_names = self._get_column_names()
        predicates: list[Any] = []

        for k, v in (filter_by or {}).items():
            if k.endswith("__in"):
                col_name = k[:-4]
                if col_name not in column_names:
                    continue
                raw_values = [val.strip() for val in str(v).split(",") if val.strip()]
                if raw_values:
                    values = self._coerce_list_values(col_name, raw_values)
                    if values:
                        predicates.append(getattr(self.model, col_name).in_(values))

            elif k in column_names and "," in str(v):
                raw_values = [val.strip() for val in str(v).split(",") if val.strip()]
                if raw_values:
                    values = self._coerce_list_values(k, raw_values)
                    if values:
                        predicates.append(getattr(self.model, k).in_(values))

            elif k.endswith("__isnull"):
                col_name = k[:-8]
                if col_name not in column_names:
                    continue
                col = getattr(self.model, col_name)
                if str(v).lower() in ("1", "true"):
                    predicates.append(or_(col.is_(None), col == ""))
                else:
                    predicates.append(and_(col.isnot(None), col != ""))

            elif k.endswith("__gte"):
                col_name = k[:-5]
                if col_name not in column_names:
                    continue
                predicates.append(getattr(self.model, col_name) >= self._coerce_value(col_name, v))

            elif k.endswith("__lte"):
                col_name = k[:-5]
                if col_name not in column_names:
                    continue
                predicates.append(getattr(self.model, col_name) <= self._coerce_value(col_name, v))

            elif k.endswith("__gt"):
                col_name = k[:-4]
                if col_name not in column_names:
                    continue
                predicates.append(getattr(self.model, col_name) > self._coerce_value(col_name, v))

            elif k.endswith("__lt"):
                col_name = k[:-4]
                if col_name not in column_names:
                    continue
                predicates.append(getattr(self.model, col_name) < self._coerce_value(col_name, v))

        return predicates

    def _coerce_list_values(self, col_name: str, raw_values: list[str]) -> list[Any]:
        col_type = self.model.__table__.columns[col_name].type
        if isinstance(col_type, (BigInteger, Integer)):
            return [int(x) for x in raw_values if x.lstrip("-").isdigit()]
        return raw_values

    def _coerce_value(self, col_name: str, v: Any) -> Any:
        col_type = self.model.__table__.columns[col_name].type
        try:
            if isinstance(col_type, (BigInteger, Integer)):
                return int(v)
            if isinstance(col_type, Numeric):
                return float(v)
            if isinstance(col_type, Date) and not isinstance(col_type, DateTime):
                from datetime import datetime as dt

                return dt.strptime(str(v), "%Y-%m-%d").date()
            if isinstance(col_type, DateTime):
                from datetime import datetime as dt

                return dt.fromisoformat(str(v))
        except (ValueError, TypeError):
            raise ValueError(f"Invalid value for {col_name}: {v}")
        return v

    def _convert_filter_values(self, filter_by: dict[str, Any]) -> dict[str, Any]:
        converted = {}
        for k, v in filter_by.items():
            column = self.model.__table__.columns[k]
            col_type = column.type
            if isinstance(col_type, (BigInteger, Integer)):
                try:
                    converted[k] = int(v)
                except (ValueError, TypeError):
                    raise ValueError(f"Invalid integer value for {k}: {v}")
            elif isinstance(col_type, Boolean):
                converted[k] = str(v).lower() in ("1", "true")
            elif isinstance(col_type, Numeric):
                try:
                    converted[k] = float(v)
                except (ValueError, TypeError):
                    raise ValueError(f"Invalid numeric value for {k}: {v}")
            elif isinstance(col_type, DateTime):
                from datetime import datetime as dt

                try:
                    converted[k] = dt.fromisoformat(str(v))
                except (ValueError, TypeError):
                    raise ValueError(f"Invalid datetime value for {k}: {v}")
            elif isinstance(col_type, Date):
                from datetime import datetime as dt

                try:
                    converted[k] = dt.strptime(str(v), "%Y-%m-%d").date()
                except (ValueError, TypeError):
                    raise ValueError(f"Invalid date value for {k}: {v}")
            elif isinstance(col_type, JSON):
                import json

                try:
                    converted[k] = json.loads(str(v))
                except json.JSONDecodeError:
                    raise ValueError(f"Invalid JSON value for {k}: {v}")
            elif isinstance(col_type, (String, Text)):
                converted[k] = str(v)
            else:
                converted[k] = v
        return converted

    def _normalize_search_pattern(self, search: str | None) -> str | None:
        if search is None:
            return None
        value = str(search).strip()
        if not value:
            return None
        return f"%{value}%"

    def _build_search_predicates(self, search_pattern: str) -> list[Any]:
        searchable = self.model.__searchable_fields__
        if searchable:
            return [
                cast(self.model.__table__.columns[name], String).ilike(search_pattern)
                for name in searchable
                if name in self.model.__table__.columns
            ]
        return [
            column.ilike(search_pattern)
            for column in self.model.__table__.columns
            if isinstance(column.type, (String, Text))
        ]

    @asynccontextmanager
    async def get_session(self):
        async with DatabaseConfig.async_session() as session:
            yield session

    async def create(self, object: ModelT):
        async with self.get_session() as session:
            session.add(object)
            await session.commit()
            await session.refresh(object)
            return object

    async def bulk_create(self, objects: list[ModelT]):
        async with self.get_session() as session:
            session.add_all(objects)
            await session.commit()
            for obj in objects:
                await session.refresh(obj)
            return objects

    def _build_base_query(
        self,
        filter_by: dict[str, Any] | None = None,
        search: str | None = None,
    ) -> tuple[dict[str, Any], list[Any], str | None]:
        advanced_predicates = self._prepare_advanced_filters(filter_by)
        sanitized_filter = self._prepare_filter_by(filter_by)
        search_pattern = self._normalize_search_pattern(search)
        return sanitized_filter, advanced_predicates, search_pattern

    def _apply_predicates(
        self,
        query: Select[Any],
        advanced_predicates: list[Any],
        search_pattern: str | None,
    ) -> Select[Any]:
        if self._soft_delete and hasattr(self.model, "deleted_at"):
            query = query.where(self.model.deleted_at.is_(None))
        if advanced_predicates:
            query = query.where(and_(*advanced_predicates))
        if search_pattern:
            predicates = self._build_search_predicates(search_pattern)
            if predicates:
                query = query.where(or_(*predicates))
        return query

    def _apply_ordering(self, query: Select[Any], order_by: list[str]) -> Select[Any]:
        for field in order_by:
            if field.startswith("-"):
                query = query.order_by(desc(getattr(self.model, field[1:])))
            else:
                query = query.order_by(asc(getattr(self.model, field)))
        return query

    def _sanitize_order_by(self, order_by: list[str] | None) -> list[str]:
        column_names = self._get_column_names()
        return [field for field in (order_by or []) if field.lstrip("-") in column_names]

    async def list(
        self,
        page: int = 1,
        page_size: int = 10,
        order_by: list[str] | None = None,
        filter_by: dict[str, Any] | None = None,
        search: str | None = None,
    ):
        sanitized_filter, advanced_predicates, search_pattern = self._build_base_query(filter_by, search)
        order_by_clean = self._sanitize_order_by(order_by)
        offset: int = (page - 1) * page_size
        async with self.get_session() as session:
            query: Select[Any] = select(self.model).filter_by(**sanitized_filter)
            query = self._apply_predicates(query, advanced_predicates, search_pattern)
            query = query.offset(offset).limit(page_size)
            query = self._apply_ordering(query, order_by_clean)
            result = await session.execute(query)
            return list(result.scalars().unique().all())

    async def list_with_count(
        self,
        page: int = 1,
        page_size: int = 10,
        order_by: builtins.list[str] | None = None,
        filter_by: dict[str, Any] | None = None,
        search: str | None = None,
    ) -> tuple[list, int]:
        sanitized_filter, advanced_predicates, search_pattern = self._build_base_query(filter_by, search)
        order_by_clean = self._sanitize_order_by(order_by)
        offset: int = (page - 1) * page_size
        async with self.get_session() as session:
            list_query: Select[Any] = select(self.model).filter_by(**sanitized_filter)
            list_query = self._apply_predicates(list_query, advanced_predicates, search_pattern)
            list_query = list_query.offset(offset).limit(page_size)
            list_query = self._apply_ordering(list_query, order_by_clean)

            count_query: Select[Any] = select(func.count()).select_from(self.model).filter_by(**sanitized_filter)
            count_query = self._apply_predicates(count_query, advanced_predicates, search_pattern)

            list_result = await session.execute(list_query)
            count_result = await session.execute(count_query)
            return (
                list(list_result.scalars().unique().all()),
                count_result.scalar_one() or 0,
            )

    async def get(self, id: int):
        async with self.get_session() as session:
            result = await session.get(self.model, id)
            if result and self._soft_delete and hasattr(result, "deleted_at") and result.deleted_at is not None:
                return None
            return result

    async def get_by_ids(self, ids: builtins.list[int]):
        if not ids:
            return []
        async with self.get_session() as session:
            query = select(self.model).where(self.model.id.in_(ids))
            if self._soft_delete and hasattr(self.model, "deleted_at"):
                query = query.where(self.model.deleted_at.is_(None))
            result = await session.execute(query)
            return list(result.scalars().unique().all())

    async def patch(self, id: int, **kwargs: dict[str, Any]):
        async with self.get_session() as session:
            instance = await session.get(self.model, id)
            if not instance:
                raise NotFoundError(self.model.__name__, id)
            if self._soft_delete and hasattr(instance, "deleted_at") and instance.deleted_at is not None:
                raise NotFoundError(self.model.__name__, id)
            column_names = self._get_column_names()
            for key, value in kwargs.items():
                if key not in column_names:
                    raise ValueError(f"Invalid field: {key}")
                setattr(instance, key, value)
            await session.commit()
            await session.refresh(instance)
            return instance

    async def delete(self, id: int):
        async with self.get_session() as session:
            instance = await session.get(self.model, id)
            if not instance:
                raise NotFoundError(self.model.__name__, id)
            if self._soft_delete and hasattr(instance, "deleted_at"):
                if instance.deleted_at is not None:
                    raise NotFoundError(self.model.__name__, id)
                from datetime import datetime

                instance.deleted_at = datetime.now(UTC)
                await session.commit()
                await session.refresh(instance)
            else:
                await session.delete(instance)
                await session.commit()

    async def bulk_delete(self, ids: builtins.list[int]):
        if not ids:
            return
        async with self.get_session() as session:
            query = select(self.model).where(self.model.id.in_(ids))
            if self._soft_delete:
                query = query.where(self.model.deleted_at.is_(None))
            result = await session.execute(query)
            instances = list(result.scalars().unique().all())
            if self._soft_delete:
                from datetime import datetime

                for instance in instances:
                    instance.deleted_at = datetime.now(UTC)
            else:
                for instance in instances:
                    await session.delete(instance)
            await session.commit()

    async def count(
        self,
        filter_by: dict[str, Any] | None = None,
        search: str | None = None,
    ):
        sanitized_filter, advanced_predicates, search_pattern = self._build_base_query(filter_by, search)
        async with self.get_session() as session:
            query: Select[Any] = select(func.count()).select_from(self.model).filter_by(**sanitized_filter)
            query = self._apply_predicates(query, advanced_predicates, search_pattern)
            result = await session.execute(query)
            return result.scalar_one() or 0

    async def exists(self, id: int) -> bool:
        async with self.get_session() as session:
            query = select(func.count()).select_from(self.model).where(self.model.id == id)
            if self._soft_delete and hasattr(self.model, "deleted_at"):
                query = query.where(self.model.deleted_at.is_(None))
            result = await session.execute(query)
            return (result.scalar_one() or 0) > 0
