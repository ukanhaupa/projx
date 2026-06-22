import pytest
from sqlalchemy import Column, String

from src.entities.audit_log import AuditLog
from src.entities.base import BaseModel_, BaseRepository


class AuditThing(BaseModel_):
    __tablename__ = "audit_things"

    name = Column(String(100), nullable=False)


@pytest.fixture
def thing_repo():
    return BaseRepository(AuditThing)


@pytest.fixture
def audit_repo():
    return BaseRepository(AuditLog)


async def audit_rows(audit_repo, action=None):
    rows = await audit_repo.list(filter_by={"table_name": "audit_things"}, page_size=100)
    if action is not None:
        rows = [r for r in rows if r.action == action]
    return rows


class TestAuditFullSurface:
    async def test_create_audits_insert(self, test_db, thing_repo, audit_repo):
        thing = await thing_repo.create(AuditThing(name="a"))
        rows = await audit_rows(audit_repo, "INSERT")
        assert len(rows) == 1
        assert rows[0].record_id == thing.id
        assert rows[0].old_value is None
        assert rows[0].new_value["name"] == "a"

    async def test_bulk_create_audits_one_insert_per_row(self, test_db, thing_repo, audit_repo):
        created = await thing_repo.bulk_create([AuditThing(name="b1"), AuditThing(name="b2"), AuditThing(name="b3")])
        rows = await audit_rows(audit_repo, "INSERT")
        assert len(rows) == 3
        assert {r.record_id for r in rows} == {t.id for t in created}

    async def test_patch_audits_update(self, test_db, thing_repo, audit_repo):
        thing = await thing_repo.create(AuditThing(name="old"))
        await thing_repo.patch(thing.id, name="new")
        rows = await audit_rows(audit_repo, "UPDATE")
        assert len(rows) == 1
        assert rows[0].old_value["name"] == "old"
        assert rows[0].new_value["name"] == "new"

    async def test_delete_audits_delete(self, test_db, thing_repo, audit_repo):
        thing = await thing_repo.create(AuditThing(name="gone"))
        await thing_repo.delete(thing.id)
        rows = await audit_rows(audit_repo, "DELETE")
        assert len(rows) == 1
        assert rows[0].record_id == thing.id
        assert rows[0].old_value["name"] == "gone"
        assert rows[0].new_value is None

    async def test_bulk_delete_audits_one_delete_per_row(self, test_db, thing_repo, audit_repo):
        created = await thing_repo.bulk_create([AuditThing(name="d1"), AuditThing(name="d2")])
        ids = [t.id for t in created]
        await thing_repo.bulk_delete(ids)
        rows = await audit_rows(audit_repo, "DELETE")
        assert len(rows) == 2
        assert {r.record_id for r in rows} == set(ids)
        assert all(r.new_value is None for r in rows)

    async def test_audit_log_itself_is_never_audited(self, test_db, thing_repo, audit_repo):
        await thing_repo.create(AuditThing(name="x"))
        meta = await audit_repo.count(filter_by={"table_name": "audit_logs"})
        assert meta == 0
