import os
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import jwt
import pytest
from dotenv import load_dotenv
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

load_dotenv(Path(__file__).resolve().parents[1] / ".env.test", override=True)

from src.app import app
from src.configs import _database as database_module
from src.configs import get_db_session
from src.entities import BaseModel_

TEST_DATABASE_URL = os.getenv("SQLALCHEMY_DATABASE_URI", "sqlite+aiosqlite:///:memory:")
IS_SQLITE = TEST_DATABASE_URL.startswith("sqlite")


@pytest.fixture(scope="function")
async def test_engine() -> AsyncGenerator[AsyncEngine, None]:
    engine_kwargs: dict = {"echo": False}
    if IS_SQLITE:
        engine_kwargs["connect_args"] = {"check_same_thread": False}
        engine_kwargs["poolclass"] = StaticPool

    engine = create_async_engine(TEST_DATABASE_URL, **engine_kwargs)

    database_module._engine = engine
    database_module._session_factory = async_sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )

    async with engine.begin() as conn:
        if not IS_SQLITE:
            await conn.run_sync(BaseModel_.metadata.drop_all)
        await conn.run_sync(BaseModel_.metadata.create_all)

    yield engine

    if not IS_SQLITE:
        async with engine.begin() as conn:
            await conn.run_sync(BaseModel_.metadata.drop_all)

    database_module._session_factory = None
    database_module._engine = None

    await engine.dispose()


@pytest.fixture(scope="function")
async def test_db(test_engine: AsyncEngine) -> AsyncGenerator[AsyncSession, None]:
    async_session = async_sessionmaker(
        test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with async_session() as session:
        session.info["user"] = "test_user"
        yield session
        await session.rollback()


@pytest.fixture
async def client(test_db: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db_session():
        yield test_db

    app.dependency_overrides[get_db_session] = override_get_db_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
def auth_token_admin() -> str:
    exp = datetime.now(UTC) + timedelta(hours=1)
    payload = {
        "sub": "1",
        "email": "test@example.com",
        "role": "admin",
        "roles": ["admin"],
        "exp": int(exp.timestamp()),
        "permissions": ["*:*.*"],
    }
    return jwt.encode(payload, "test-secret-that-is-at-least-32-bytes-long", algorithm="HS256")


@pytest.fixture
def auth_token_user() -> str:
    exp = datetime.now(UTC) + timedelta(hours=1)
    payload = {
        "sub": "2",
        "email": "user@test.com",
        "role": "user",
        "roles": ["user"],
        "exp": int(exp.timestamp()),
        "permissions": ["*:read.*"],
        "permissions_map": {"*": ["read.*"]},
    }
    return jwt.encode(payload, "test-secret-that-is-at-least-32-bytes-long", algorithm="HS256")


@pytest.fixture
def auth_headers_admin(auth_token_admin: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {auth_token_admin}"}


@pytest.fixture
def auth_headers_user(auth_token_user: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {auth_token_user}"}
