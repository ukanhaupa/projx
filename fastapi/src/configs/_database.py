import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from src.middlewares._user_context import get_current_user  # pragma: allow-private-import

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None

APPLICATION_NAME = "projx-fastapi"
TIMEOUT = int(os.getenv("DB_STATEMENT_TIMEOUT", "5"))


class DatabaseConfig:
    @classmethod
    def get_engine(cls) -> AsyncEngine:
        global _engine
        if _engine is None:
            db_uri = os.getenv("SQLALCHEMY_DATABASE_URI")
            if not db_uri:
                raise RuntimeError(
                    "SQLALCHEMY_DATABASE_URI environment variable is not set. "
                    "Please configure the database connection string."
                )
            timeout_ms = TIMEOUT * 1000
            _engine = create_async_engine(
                url=db_uri,
                echo=os.getenv("DB_ECHO", "false").lower() == "true",
                pool_recycle=1800,
                pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
                max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
                pool_pre_ping=True,
                pool_timeout=int(os.getenv("DB_POOL_TIMEOUT", "30")),
                connect_args={
                    "server_settings": {
                        "application_name": APPLICATION_NAME,
                        "statement_timeout": str(timeout_ms),
                        "idle_in_transaction_session_timeout": str(timeout_ms * 2),
                    },
                },
            )
        return _engine

    @classmethod
    def _get_session_factory(cls) -> async_sessionmaker[AsyncSession]:
        global _session_factory
        if _session_factory is None:
            _session_factory = async_sessionmaker(
                bind=cls.get_engine(),
                autoflush=False,
                autocommit=False,
                expire_on_commit=False,
            )
        return _session_factory

    @classmethod
    @asynccontextmanager
    async def async_session(cls, timeout: int = TIMEOUT) -> AsyncIterator[AsyncSession]:
        session_factory = cls._get_session_factory()
        async with session_factory() as session:
            await session.connection()
            user = get_current_user()
            session.info["user"] = user.user_id if user else "system"
            try:
                async with asyncio.timeout(timeout):
                    yield session
            except TimeoutError:
                await session.rollback()
                await session.invalidate()
                logger.warning(
                    "Session killed: exceeded {}s timeout. Investigate the slow query and optimise it.",
                    timeout,
                )
                raise
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    @classmethod
    async def dispose(cls) -> None:
        global _engine, _session_factory
        if _engine is not None:
            await _engine.dispose()
        _engine = None
        _session_factory = None


async def get_db_session() -> AsyncIterator[AsyncSession]:
    async with DatabaseConfig.async_session() as session:
        yield session
