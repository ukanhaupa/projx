import asyncio
import os
from contextlib import asynccontextmanager

from loguru import logger
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

_engine = None
_session_factory = None

TIMEOUT = int(os.getenv("DB_STATEMENT_TIMEOUT", "5"))


class DatabaseConfig:
    @classmethod
    def get_engine(cls):
        global _engine
        if _engine is None:
            db_uri = os.getenv("SQLALCHEMY_DATABASE_URI")
            if not db_uri:
                raise RuntimeError(
                    "SQLALCHEMY_DATABASE_URI environment variable is not set. "
                    "Please configure the database connection string."
                )
            _engine = create_async_engine(
                url=db_uri,
                pool_recycle=1800,
                pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
                max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
                pool_pre_ping=True,
                pool_timeout=30,
            )
        return _engine

    @classmethod
    def _get_session_factory(cls):
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
    async def async_session(cls, timeout=TIMEOUT):
        session_factory = cls._get_session_factory()
        async with session_factory() as session:
            from src.middlewares import get_current_user

            user = get_current_user()
            session.info["user"] = user.user_id if user else "system"
            try:
                async with asyncio.timeout(timeout):
                    yield session
            except TimeoutError:
                await session.rollback()
                await session.invalidate()
                logger.exception(
                    f"Session killed: exceeded {timeout}s timeout. Investigate the slow query and optimise it."
                )
                raise
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()


async def get_db_session():
    async with DatabaseConfig.async_session() as session:
        yield session
