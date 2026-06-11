import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.entities.service_config._repository import ServiceConfigRepository  # pragma: allow-private-import


@pytest.fixture(autouse=True)
async def _clear(test_db: AsyncSession):
    ServiceConfigRepository.invalidate()
    await test_db.execute(text("DELETE FROM service_configs"))
    await test_db.commit()
    yield
    await test_db.execute(text("DELETE FROM service_configs"))
    await test_db.commit()
    ServiceConfigRepository.invalidate()


async def test_returns_none_when_missing():
    assert await ServiceConfigRepository().get_config("smtp") is None


async def test_round_trip():
    repo = ServiceConfigRepository()
    await repo.set_config("smtp", {"host": "mail.example", "port": 587})
    assert await repo.get_config("smtp") == {"host": "mail.example", "port": 587}


async def test_persists_ciphertext_not_plaintext(test_db: AsyncSession):
    await ServiceConfigRepository().set_config("smtp", {"password": "super-secret-value"})
    row = (await test_db.execute(text("SELECT config FROM service_configs WHERE purpose = 'smtp'"))).scalar_one()
    assert "super-secret-value" not in row


async def test_update_in_place(test_db: AsyncSession):
    repo = ServiceConfigRepository()
    await repo.set_config("smtp", {"host": "old"})
    await repo.set_config("smtp", {"host": "new"})
    assert await repo.get_config("smtp") == {"host": "new"}
    count = (await test_db.execute(text("SELECT COUNT(*) FROM service_configs WHERE purpose = 'smtp'"))).scalar_one()
    assert count == 1


async def test_ignores_inactive_rows(test_db: AsyncSession):
    await ServiceConfigRepository().set_config("sentry", {"dsn": "d"})
    await test_db.execute(text("UPDATE service_configs SET is_active = false WHERE purpose = 'sentry'"))
    await test_db.commit()
    ServiceConfigRepository.invalidate()
    assert await ServiceConfigRepository().get_config("sentry") is None


async def test_caches_until_invalidated(test_db: AsyncSession):
    repo = ServiceConfigRepository()
    await repo.set_config("sentry", {"dsn": "first"})
    assert (await repo.get_config("sentry")) == {"dsn": "first"}

    await test_db.execute(text("DELETE FROM service_configs"))
    await test_db.commit()
    assert (await repo.get_config("sentry")) == {"dsn": "first"}

    ServiceConfigRepository.invalidate("sentry")
    assert await repo.get_config("sentry") is None
