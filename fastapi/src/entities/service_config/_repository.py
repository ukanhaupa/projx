import time
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.utils import decrypt_config, encrypt_config

from ._model import ServiceConfig

CACHE_TTL = 600
_cache: dict[str, tuple[dict[str, Any], float]] = {}


class ServiceConfigRepository:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def get_config(self, purpose: str) -> dict[str, Any] | None:
        cached = _cache.get(purpose)
        if cached and cached[1] > time.monotonic():
            return cached[0]

        row = await self._get_active(purpose)
        if row is None:
            return None

        data = decrypt_config(cast("str", row.config))
        _cache[purpose] = (data, time.monotonic() + CACHE_TTL)
        return data

    async def set_config(self, purpose: str, config: dict[str, Any]) -> None:
        encrypted = encrypt_config(config)
        existing = await self._get_active(purpose)
        if existing is not None:
            existing.config = encrypted  # type: ignore[assignment]
            existing.is_active = True  # type: ignore[assignment]
        else:
            self._session.add(ServiceConfig(purpose=purpose, config=encrypted, is_active=True))
        await self._session.flush()
        self.invalidate(purpose)

    async def _get_active(self, purpose: str) -> ServiceConfig | None:
        stmt = select(ServiceConfig).where(
            ServiceConfig.purpose == purpose,
            ServiceConfig.is_active.is_(True),
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    def invalidate(purpose: str | None = None) -> None:
        if purpose is None:
            _cache.clear()
            return
        _cache.pop(purpose, None)
