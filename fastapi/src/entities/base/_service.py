from __future__ import annotations

import builtins
from typing import Any, TypeVar, cast

from ._repository import BaseRepository

RepositoryT = TypeVar("RepositoryT", bound="BaseRepository")


class BaseService:
    def __init__(self, repository: type[RepositoryT]):
        self.repository = cast("RepositoryT", cast("Any", repository)())

    async def create(self, data: dict[str, Any]) -> Any:
        return await self.repository.create(entity=self.repository.model(**data))

    async def bulk_create(self, items: list[dict[str, Any]]) -> list[Any]:
        objects = [self.repository.model(**data) for data in items]
        return await self.repository.bulk_create(objects)

    async def bulk_delete(self, ids: list[int]):
        return await self.repository.bulk_delete(ids)

    async def list(
        self,
        page: int = 1,
        page_size: int = 10,
        order_by: list[str] | None = None,
        filter_by: dict[str, Any] | None = None,
        search: str | None = None,
    ) -> list[Any]:
        return await self.repository.list(
            page=page,
            page_size=page_size,
            filter_by=filter_by,
            order_by=order_by,
            search=search,
        )

    async def list_with_count(
        self,
        page: int = 1,
        page_size: int = 10,
        order_by: builtins.list[str] | None = None,
        filter_by: dict[str, Any] | None = None,
        search: str | None = None,
    ) -> tuple[builtins.list[Any], int]:
        return await self.repository.list_with_count(
            page=page,
            page_size=page_size,
            filter_by=filter_by,
            order_by=order_by,
            search=search,
        )

    async def get(self, id: int):
        return await self.repository.get(id=id)

    async def get_by_ids(self, ids: builtins.list[int]) -> builtins.list[Any]:
        return await self.repository.get_by_ids(ids)

    async def patch(self, id: int, data: dict[str, Any]) -> Any:
        return await self.repository.patch(id=id, **data)

    async def delete(self, id: int):
        return await self.repository.delete(id=id)

    async def count(self, filter_by: dict[str, Any] | None = None, search: str | None = None) -> int:
        return await self.repository.count(filter_by=filter_by, search=search)

    async def exists(self, id: int) -> bool:
        return await self.repository.exists(id=id)
