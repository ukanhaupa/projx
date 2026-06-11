import time
from typing import Any

from sqlalchemy import select

from src.configs import DatabaseConfig
from src.utils import decrypt_config, encrypt_config

from ._model import ServiceConfig

CACHE_TTL = 600
_cache: dict[str, tuple[dict[str, Any], float]] = {}


class ServiceConfigRepository:
    async def get_config(self, purpose: str) -> dict[str, Any] | None:
        cached = _cache.get(purpose)
        if cached and cached[1] > time.monotonic():
            return cached[0]

        stmt = select(ServiceConfig.config).where(
            ServiceConfig.purpose == purpose,
            ServiceConfig.is_active.is_(True),
        )
        async with DatabaseConfig.async_session() as session:
            ciphertext = (await session.execute(stmt)).scalar_one_or_none()

        if ciphertext is None:
            return None

        data = decrypt_config(ciphertext)
        _cache[purpose] = (data, time.monotonic() + CACHE_TTL)
        return data

    async def set_config(self, purpose: str, config: dict[str, Any]) -> None:
        encrypted = encrypt_config(config)
        stmt = select(ServiceConfig).where(ServiceConfig.purpose == purpose)
        async with DatabaseConfig.async_session() as session:
            existing = (await session.execute(stmt)).scalar_one_or_none()
            if existing is not None:
                existing.config = encrypted  # type: ignore[assignment]
                existing.is_active = True  # type: ignore[assignment]
            else:
                session.add(ServiceConfig(purpose=purpose, config=encrypted, is_active=True))
            await session.commit()
        self.invalidate(purpose)

    @staticmethod
    def invalidate(purpose: str | None = None) -> None:
        if purpose is None:
            _cache.clear()
            return
        _cache.pop(purpose, None)
