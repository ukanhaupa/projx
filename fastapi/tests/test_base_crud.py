from datetime import UTC, datetime

import pytest
from sqlalchemy import Column, DateTime, Numeric, String

from src.entities.base._model import BaseModel_, SoftDeleteMixin
from src.entities.base._repository import BaseRepository
from src.entities.base._service import BaseService

# ── Test-only models ────────────────────────────────────────────────


class Widget(BaseModel_):
    __tablename__ = "widgets"
    __searchable_fields__ = {"name"}

    name = Column(String(100), nullable=False)
    description = Column(String(500), nullable=True)
    price = Column(Numeric(10, 2), nullable=True)


class SoftWidget(SoftDeleteMixin, BaseModel_):
    __tablename__ = "soft_widgets"
    __soft_delete__ = True

    name = Column(String(100), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


# ── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
def widget_repo():
    return BaseRepository(Widget)


@pytest.fixture
def widget_service():
    repo_cls = type(
        "WidgetRepo",
        (BaseRepository,),
        {
            "__init__": lambda self: BaseRepository.__init__(self, Widget),
        },
    )
    svc_cls = type(
        "WidgetService",
        (BaseService,),
        {
            "__init__": lambda self: BaseService.__init__(self, repo_cls),
        },
    )
    return svc_cls()


@pytest.fixture
def soft_repo():
    return BaseRepository(SoftWidget)


# ── Repository: CRUD ────────────────────────────────────────────────


class TestRepositoryCrud:
    @pytest.mark.asyncio
    async def test_create(self, test_db, widget_repo):
        result = await widget_repo.create(Widget(name="Bolt", price=9.99))
        assert result.id is not None
        assert result.name == "Bolt"

    @pytest.mark.asyncio
    async def test_get(self, test_db, widget_repo):
        created = await widget_repo.create(Widget(name="Nut"))
        fetched = await widget_repo.get(created.id)
        assert fetched.name == "Nut"

    @pytest.mark.asyncio
    async def test_get_not_found(self, test_db, widget_repo):
        result = await widget_repo.get(99999)
        assert result is None

    @pytest.mark.asyncio
    async def test_patch(self, test_db, widget_repo):
        created = await widget_repo.create(Widget(name="Old"))
        updated = await widget_repo.patch(created.id, name="New")
        assert updated.name == "New"

    @pytest.mark.asyncio
    async def test_patch_not_found(self, test_db, widget_repo):
        with pytest.raises(Exception, match="not found"):
            await widget_repo.patch(99999, name="X")

    @pytest.mark.asyncio
    async def test_patch_invalid_field(self, test_db, widget_repo):
        created = await widget_repo.create(Widget(name="Test"))
        with pytest.raises(Exception, match="Invalid field"):
            await widget_repo.patch(created.id, nonexistent="value")

    @pytest.mark.asyncio
    async def test_delete(self, test_db, widget_repo):
        created = await widget_repo.create(Widget(name="Gone"))
        await widget_repo.delete(created.id)
        assert await widget_repo.get(created.id) is None

    @pytest.mark.asyncio
    async def test_delete_not_found(self, test_db, widget_repo):
        with pytest.raises(Exception, match="not found"):
            await widget_repo.delete(99999)


# ── Repository: Bulk ────────────────────────────────────────────────


class TestRepositoryBulk:
    @pytest.mark.asyncio
    async def test_bulk_create(self, test_db, widget_repo):
        objects = [Widget(name=f"Bulk{i}") for i in range(3)]
        results = await widget_repo.bulk_create(objects)
        assert len(results) == 3
        assert all(r.id is not None for r in results)

    @pytest.mark.asyncio
    async def test_bulk_delete(self, test_db, widget_repo):
        objects = [Widget(name=f"Del{i}") for i in range(3)]
        created = await widget_repo.bulk_create(objects)
        ids = [c.id for c in created]

        await widget_repo.bulk_delete(ids)
        for wid in ids:
            assert await widget_repo.get(wid) is None

    @pytest.mark.asyncio
    async def test_bulk_delete_skips_missing(self, test_db, widget_repo):
        created = await widget_repo.create(Widget(name="Exists"))
        await widget_repo.bulk_delete([created.id, 99999])
        assert await widget_repo.get(created.id) is None


# ── Repository: List, Filter, Search, Pagination ────────────────────


class TestRepositoryQuery:
    @pytest.mark.asyncio
    async def test_list(self, test_db, widget_repo):
        await widget_repo.bulk_create([Widget(name="A"), Widget(name="B")])
        results = await widget_repo.list()
        assert len(results) >= 2

    @pytest.mark.asyncio
    async def test_list_with_count(self, test_db, widget_repo):
        await widget_repo.bulk_create([Widget(name="X"), Widget(name="Y")])
        results, total = await widget_repo.list_with_count()
        assert len(results) >= 2
        assert total >= 2

    @pytest.mark.asyncio
    async def test_filter_by(self, test_db, widget_repo):
        await widget_repo.bulk_create([Widget(name="Alpha"), Widget(name="Beta")])
        results = await widget_repo.list(filter_by={"name": "Alpha"})
        assert all(r.name == "Alpha" for r in results)

    @pytest.mark.asyncio
    async def test_filter_in(self, test_db, widget_repo):
        await widget_repo.bulk_create(
            [
                Widget(name="A"),
                Widget(name="B"),
                Widget(name="C"),
            ]
        )
        results = await widget_repo.list(filter_by={"name__in": "A,B"})
        names = {r.name for r in results}
        assert "A" in names
        assert "B" in names
        assert "C" not in names

    @pytest.mark.asyncio
    async def test_filter_comma_separated(self, test_db, widget_repo):
        await widget_repo.bulk_create(
            [
                Widget(name="A"),
                Widget(name="B"),
                Widget(name="C"),
            ]
        )
        results = await widget_repo.list(filter_by={"name": "A,B"})
        names = {r.name for r in results}
        assert "C" not in names

    @pytest.mark.asyncio
    async def test_filter_gte_lte(self, test_db, widget_repo):
        await widget_repo.bulk_create(
            [
                Widget(name="Cheap", price=10),
                Widget(name="Mid", price=50),
                Widget(name="Expensive", price=100),
            ]
        )
        results = await widget_repo.list(filter_by={"price__gte": "20", "price__lte": "60"})
        assert len(results) >= 1
        assert all(20 <= float(r.price) <= 60 for r in results)

    @pytest.mark.asyncio
    async def test_filter_gte_invalid_value(self, test_db, widget_repo):
        await widget_repo.create(Widget(name="Test", price=10))
        with pytest.raises(ValueError, match="Invalid value"):
            await widget_repo.list(filter_by={"price__gte": "not-a-number"})

    @pytest.mark.asyncio
    async def test_filter_isnull(self, test_db, widget_repo):
        await widget_repo.bulk_create(
            [
                Widget(name="Has Desc", description="something"),
                Widget(name="No Desc", description=None),
            ]
        )
        results = await widget_repo.list(filter_by={"description__isnull": "true"})
        assert len(results) >= 1
        assert all(r.description is None or r.description == "" for r in results)

    @pytest.mark.asyncio
    async def test_search(self, test_db, widget_repo):
        await widget_repo.bulk_create(
            [
                Widget(name="Searchable Item"),
                Widget(name="Other Thing"),
            ]
        )
        results = await widget_repo.list(search="Searchable")
        assert len(results) >= 1
        assert any("Searchable" in r.name for r in results)

    @pytest.mark.asyncio
    async def test_pagination(self, test_db, widget_repo):
        await widget_repo.bulk_create([Widget(name=f"W{i}") for i in range(15)])
        page1 = await widget_repo.list(page=1, page_size=5)
        page2 = await widget_repo.list(page=2, page_size=5)
        assert len(page1) == 5
        assert len(page2) == 5
        assert page1[0].id != page2[0].id

    @pytest.mark.asyncio
    async def test_order_by_asc(self, test_db, widget_repo):
        await widget_repo.bulk_create([Widget(name="Z"), Widget(name="A"), Widget(name="M")])
        results = await widget_repo.list(order_by=["name"])
        names = [r.name for r in results]
        assert names == sorted(names)

    @pytest.mark.asyncio
    async def test_order_by_desc(self, test_db, widget_repo):
        await widget_repo.bulk_create([Widget(name="Z"), Widget(name="A"), Widget(name="M")])
        results = await widget_repo.list(order_by=["-name"])
        names = [r.name for r in results]
        assert names == sorted(names, reverse=True)

    @pytest.mark.asyncio
    async def test_count(self, test_db, widget_repo):
        await widget_repo.bulk_create([Widget(name="C1"), Widget(name="C2")])
        total = await widget_repo.count()
        assert total >= 2

    @pytest.mark.asyncio
    async def test_count_with_filter(self, test_db, widget_repo):
        await widget_repo.bulk_create([Widget(name="Counted"), Widget(name="Other")])
        total = await widget_repo.count(filter_by={"name": "Counted"})
        assert total >= 1

    @pytest.mark.asyncio
    async def test_count_with_search(self, test_db, widget_repo):
        await widget_repo.bulk_create([Widget(name="FindMe"), Widget(name="Nope")])
        total = await widget_repo.count(search="FindMe")
        assert total >= 1

    @pytest.mark.asyncio
    async def test_get_by_ids(self, test_db, widget_repo):
        created = await widget_repo.bulk_create([Widget(name="G1"), Widget(name="G2")])
        ids = [c.id for c in created]
        results = await widget_repo.get_by_ids(ids)
        assert len(results) == 2

    @pytest.mark.asyncio
    async def test_get_by_ids_empty(self, test_db, widget_repo):
        results = await widget_repo.get_by_ids([])
        assert results == []


# ── Soft-delete ─────────────────────────────────────────────────────


class TestSoftDelete:
    @pytest.mark.asyncio
    async def test_delete_sets_deleted_at(self, test_db, soft_repo):
        created = await soft_repo.create(SoftWidget(name="Temp"))
        await soft_repo.delete(created.id)

        # get() should return None for soft-deleted
        assert await soft_repo.get(created.id) is None

    @pytest.mark.asyncio
    async def test_list_excludes_deleted(self, test_db, soft_repo):
        await soft_repo.create(SoftWidget(name="Visible"))
        await soft_repo.create(SoftWidget(name="Hidden", deleted_at=datetime.now(UTC)))

        results = await soft_repo.list()
        names = [r.name for r in results]
        assert "Visible" in names
        assert "Hidden" not in names

    @pytest.mark.asyncio
    async def test_get_by_ids_excludes_deleted(self, test_db, soft_repo):
        w1 = await soft_repo.create(SoftWidget(name="Alive"))
        w2 = await soft_repo.create(SoftWidget(name="Dead", deleted_at=datetime.now(UTC)))

        results = await soft_repo.get_by_ids([w1.id, w2.id])
        names = [r.name for r in results]
        assert "Alive" in names
        assert "Dead" not in names

    @pytest.mark.asyncio
    async def test_patch_blocked_on_deleted(self, test_db, soft_repo):
        created = await soft_repo.create(SoftWidget(name="Deleted"))
        await soft_repo.delete(created.id)

        with pytest.raises(Exception, match="not found"):
            await soft_repo.patch(created.id, name="Revived")

    @pytest.mark.asyncio
    async def test_bulk_delete_soft(self, test_db, soft_repo):
        created = await soft_repo.bulk_create(
            [
                SoftWidget(name="S1"),
                SoftWidget(name="S2"),
            ]
        )
        ids = [c.id for c in created]

        await soft_repo.bulk_delete(ids)
        for wid in ids:
            assert await soft_repo.get(wid) is None

    @pytest.mark.asyncio
    async def test_count_excludes_deleted(self, test_db, soft_repo):
        await soft_repo.create(SoftWidget(name="Counted"))
        await soft_repo.create(SoftWidget(name="Not Counted", deleted_at=datetime.now(UTC)))

        total = await soft_repo.count()
        assert total >= 1
        # The deleted one should not be counted — total should reflect only non-deleted
        all_results = await soft_repo.list()
        assert total == len(all_results)


# ── Service layer ───────────────────────────────────────────────────


class TestService:
    @pytest.mark.asyncio
    async def test_create(self, test_db, widget_service):
        result = await widget_service.create({"name": "SvcTest"})
        assert result.id is not None

    @pytest.mark.asyncio
    async def test_list(self, test_db, widget_service):
        await widget_service.create({"name": "S1"})
        await widget_service.create({"name": "S2"})
        results = await widget_service.list()
        assert len(results) >= 2

    @pytest.mark.asyncio
    async def test_list_with_count(self, test_db, widget_service):
        await widget_service.create({"name": "SC1"})
        _results, total = await widget_service.list_with_count()
        assert total >= 1

    @pytest.mark.asyncio
    async def test_get(self, test_db, widget_service):
        created = await widget_service.create({"name": "GetMe"})
        result = await widget_service.get(created.id)
        assert result.name == "GetMe"

    @pytest.mark.asyncio
    async def test_patch(self, test_db, widget_service):
        created = await widget_service.create({"name": "Before"})
        updated = await widget_service.patch(created.id, {"name": "After"})
        assert updated.name == "After"

    @pytest.mark.asyncio
    async def test_delete(self, test_db, widget_service):
        created = await widget_service.create({"name": "Bye"})
        await widget_service.delete(created.id)
        assert await widget_service.get(created.id) is None

    @pytest.mark.asyncio
    async def test_count(self, test_db, widget_service):
        await widget_service.create({"name": "Count1"})
        total = await widget_service.count()
        assert total >= 1

    @pytest.mark.asyncio
    async def test_bulk_create(self, test_db, widget_service):
        results = await widget_service.bulk_create(
            [
                {"name": "B1"},
                {"name": "B2"},
            ]
        )
        assert len(results) == 2

    @pytest.mark.asyncio
    async def test_bulk_delete(self, test_db, widget_service):
        results = await widget_service.bulk_create(
            [
                {"name": "BD1"},
                {"name": "BD2"},
            ]
        )
        ids = [r.id for r in results]
        await widget_service.bulk_delete(ids)
        for wid in ids:
            assert await widget_service.get(wid) is None
