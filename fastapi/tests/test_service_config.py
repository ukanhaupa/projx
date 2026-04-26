import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.entities.service_config._repository import ServiceConfigRepository


@pytest.fixture(autouse=True)
async def _clear(test_db: AsyncSession):
    ServiceConfigRepository.invalidate()
    await test_db.execute(text("DELETE FROM service_configs"))
    await test_db.flush()
    yield
    ServiceConfigRepository.invalidate()


async def test_returns_none_when_missing(test_db: AsyncSession):
    repo = ServiceConfigRepository(test_db)
    assert await repo.get_config("smtp") is None


async def test_round_trip(test_db: AsyncSession):
    repo = ServiceConfigRepository(test_db)
    await repo.set_config("smtp", {"host": "mail.example", "port": 587})
    got = await repo.get_config("smtp")
    assert got == {"host": "mail.example", "port": 587}


async def test_persists_ciphertext_not_plaintext(test_db: AsyncSession):
    repo = ServiceConfigRepository(test_db)
    await repo.set_config("smtp", {"password": "super-secret-value"})
    row = (await test_db.execute(text("SELECT config FROM service_configs WHERE purpose = 'smtp'"))).scalar_one()
    assert "super-secret-value" not in row


async def test_update_in_place(test_db: AsyncSession):
    repo = ServiceConfigRepository(test_db)
    await repo.set_config("smtp", {"host": "old"})
    await repo.set_config("smtp", {"host": "new"})
    got = await repo.get_config("smtp")
    assert got == {"host": "new"}
    count = (await test_db.execute(text("SELECT COUNT(*) FROM service_configs WHERE purpose = 'smtp'"))).scalar_one()
    assert count == 1
