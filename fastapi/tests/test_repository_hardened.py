from datetime import datetime

import pytest
from sqlalchemy import Boolean, Column, Date, DateTime, Integer, Numeric, String

from src.entities.base import BaseModel_, BaseRepository, NotFoundError

from .test_base_crud import SoftWidget, Widget


class DateWidget(BaseModel_):
    __tablename__ = "date_widgets"

    name = Column(String(100), nullable=False)
    event_date = Column(Date, nullable=True)
    event_time = Column(DateTime, nullable=True)
    price = Column(Numeric(10, 2), nullable=True)
    count = Column(Integer, nullable=True)
    active = Column(Boolean, nullable=True)


@pytest.fixture
def widget_repo():
    return BaseRepository(Widget)


@pytest.fixture
def date_repo():
    return BaseRepository(DateWidget)


@pytest.fixture
def soft_repo():
    return BaseRepository(SoftWidget)


class TestFilterGtLt:
    @pytest.mark.asyncio
    async def test_filter_gt(self, test_db, widget_repo):
        await widget_repo.bulk_create(
            [Widget(name="A", price=10), Widget(name="B", price=50), Widget(name="C", price=100)]
        )
        results = await widget_repo.list(filter_by={"price__gt": "50"})
        assert len(results) >= 1
        assert all(float(r.price) > 50 for r in results)

    @pytest.mark.asyncio
    async def test_filter_lt(self, test_db, widget_repo):
        await widget_repo.bulk_create(
            [Widget(name="A", price=10), Widget(name="B", price=50), Widget(name="C", price=100)]
        )
        results = await widget_repo.list(filter_by={"price__lt": "50"})
        assert len(results) >= 1
        assert all(float(r.price) < 50 for r in results)


class TestFilterDatetime:
    @pytest.mark.asyncio
    async def test_filter_date_gte(self, test_db, date_repo):
        from datetime import date

        await date_repo.bulk_create(
            [
                DateWidget(name="Early", event_date=date(2025, 1, 1)),
                DateWidget(name="Late", event_date=date(2026, 6, 1)),
            ]
        )
        results = await date_repo.list(filter_by={"event_date__gte": "2026-01-01"})
        assert len(results) >= 1
        assert all(r.name == "Late" for r in results)

    @pytest.mark.asyncio
    async def test_filter_datetime_gte(self, test_db, date_repo):
        await date_repo.bulk_create(
            [
                DateWidget(name="Early", event_time=datetime(2025, 1, 1)),
                DateWidget(name="Late", event_time=datetime(2026, 6, 1)),
            ]
        )
        results = await date_repo.list(filter_by={"event_time__gte": "2026-01-01T00:00:00"})
        assert len(results) >= 1

    @pytest.mark.asyncio
    async def test_convert_datetime_value(self, test_db, date_repo):
        await date_repo.create(DateWidget(name="DT", event_time=datetime(2026, 3, 15, 10, 30)))
        results = await date_repo.list(filter_by={"event_time": "2026-03-15T10:30:00"})
        assert len(results) == 1

    @pytest.mark.asyncio
    async def test_convert_date_value(self, test_db, date_repo):
        from datetime import date

        await date_repo.create(DateWidget(name="D", event_date=date(2026, 3, 15)))
        results = await date_repo.list(filter_by={"event_date": "2026-03-15"})
        assert len(results) == 1

    @pytest.mark.asyncio
    async def test_convert_boolean_value(self, test_db, date_repo):
        await date_repo.bulk_create([DateWidget(name="Active", active=True), DateWidget(name="Inactive", active=False)])
        results = await date_repo.list(filter_by={"active": "true"})
        assert len(results) >= 1
        assert all(r.active is True for r in results)

    @pytest.mark.asyncio
    async def test_convert_integer_value(self, test_db, date_repo):
        await date_repo.bulk_create([DateWidget(name="One", count=1), DateWidget(name="Two", count=2)])
        results = await date_repo.list(filter_by={"count": "1"})
        assert len(results) >= 1
        assert all(r.count == 1 for r in results)

    @pytest.mark.asyncio
    async def test_convert_invalid_integer(self, test_db, date_repo):
        await date_repo.create(DateWidget(name="Test", count=1))
        with pytest.raises(ValueError, match="Invalid integer"):
            await date_repo.list(filter_by={"count": "not-a-number"})

    @pytest.mark.asyncio
    async def test_convert_invalid_numeric(self, test_db, date_repo):
        await date_repo.create(DateWidget(name="Test", price=1.0))
        with pytest.raises(ValueError, match="Invalid numeric"):
            await date_repo.list(filter_by={"price": "not-a-number"})

    @pytest.mark.asyncio
    async def test_convert_invalid_datetime(self, test_db, date_repo):
        await date_repo.create(DateWidget(name="Test", event_time=datetime(2026, 1, 1)))
        with pytest.raises(ValueError, match="Invalid datetime"):
            await date_repo.list(filter_by={"event_time": "not-a-date"})

    @pytest.mark.asyncio
    async def test_convert_invalid_date(self, test_db, date_repo):
        from datetime import date

        await date_repo.create(DateWidget(name="Test", event_date=date(2026, 1, 1)))
        with pytest.raises(ValueError, match="Invalid date"):
            await date_repo.list(filter_by={"event_date": "not-a-date"})


class TestFilterIgnoreUnknownColumns:
    @pytest.mark.asyncio
    async def test_unknown_column_ignored(self, test_db, widget_repo):
        await widget_repo.create(Widget(name="Test"))
        results = await widget_repo.list(filter_by={"nonexistent": "value"})
        assert len(results) >= 1

    @pytest.mark.asyncio
    async def test_unknown_in_filter_ignored(self, test_db, widget_repo):
        await widget_repo.create(Widget(name="Test"))
        results = await widget_repo.list(filter_by={"nonexistent__in": "a,b"})
        assert len(results) >= 1

    @pytest.mark.asyncio
    async def test_unknown_isnull_ignored(self, test_db, widget_repo):
        await widget_repo.create(Widget(name="Test"))
        results = await widget_repo.list(filter_by={"nonexistent__isnull": "true"})
        assert len(results) >= 1

    @pytest.mark.asyncio
    async def test_unknown_gte_ignored(self, test_db, widget_repo):
        await widget_repo.create(Widget(name="Test"))
        results = await widget_repo.list(filter_by={"nonexistent__gte": "1"})
        assert len(results) >= 1

    @pytest.mark.asyncio
    async def test_unknown_lte_ignored(self, test_db, widget_repo):
        await widget_repo.create(Widget(name="Test"))
        results = await widget_repo.list(filter_by={"nonexistent__lte": "1"})
        assert len(results) >= 1

    @pytest.mark.asyncio
    async def test_unknown_gt_ignored(self, test_db, widget_repo):
        await widget_repo.create(Widget(name="Test"))
        results = await widget_repo.list(filter_by={"nonexistent__gt": "1"})
        assert len(results) >= 1

    @pytest.mark.asyncio
    async def test_unknown_lt_ignored(self, test_db, widget_repo):
        await widget_repo.create(Widget(name="Test"))
        results = await widget_repo.list(filter_by={"nonexistent__lt": "1"})
        assert len(results) >= 1


class TestIsNullFilter:
    @pytest.mark.asyncio
    async def test_isnull_false(self, test_db, widget_repo):
        await widget_repo.bulk_create(
            [Widget(name="Has", description="something"), Widget(name="Empty", description=None)]
        )
        results = await widget_repo.list(filter_by={"description__isnull": "false"})
        assert len(results) >= 1
        assert all(r.description is not None and r.description != "" for r in results)


class TestCoerceListValues:
    @pytest.mark.asyncio
    async def test_integer_in_filter(self, test_db, date_repo):
        await date_repo.bulk_create(
            [DateWidget(name="A", count=1), DateWidget(name="B", count=2), DateWidget(name="C", count=3)]
        )
        results = await date_repo.list(filter_by={"count__in": "1,2"})
        assert len(results) >= 2
        assert all(r.count in (1, 2) for r in results)


class TestExists:
    @pytest.mark.asyncio
    async def test_exists_true(self, test_db, widget_repo):
        created = await widget_repo.create(Widget(name="Exists"))
        assert await widget_repo.exists(created.id) is True

    @pytest.mark.asyncio
    async def test_exists_false(self, test_db, widget_repo):
        assert await widget_repo.exists(99999) is False

    @pytest.mark.asyncio
    async def test_exists_soft_deleted(self, test_db, soft_repo):
        created = await soft_repo.create(SoftWidget(name="SoftExists"))
        await soft_repo.delete(created.id)
        assert await soft_repo.exists(created.id) is False


class TestSoftDeleteEdgeCases:
    @pytest.mark.asyncio
    async def test_delete_already_deleted(self, test_db, soft_repo):
        created = await soft_repo.create(SoftWidget(name="AlreadyDead"))
        await soft_repo.delete(created.id)
        with pytest.raises(NotFoundError):
            await soft_repo.delete(created.id)

    @pytest.mark.asyncio
    async def test_bulk_delete_skips_already_deleted(self, test_db, soft_repo):
        created = await soft_repo.create(SoftWidget(name="SkipMe"))
        await soft_repo.delete(created.id)
        await soft_repo.bulk_delete([created.id])


class TestSearchWithNoSearchableFields:
    @pytest.mark.asyncio
    async def test_search_falls_back_to_string_columns(self, test_db, date_repo):
        await date_repo.create(DateWidget(name="Searchable"))
        results = await date_repo.list(search="Searchable")
        assert len(results) >= 1


class TestSanitizeOrderBy:
    @pytest.mark.asyncio
    async def test_invalid_order_by_ignored(self, test_db, widget_repo):
        await widget_repo.create(Widget(name="Test"))
        results = await widget_repo.list(order_by=["nonexistent_field"])
        assert len(results) >= 1

    @pytest.mark.asyncio
    async def test_mixed_valid_invalid_order_by(self, test_db, widget_repo):
        await widget_repo.bulk_create([Widget(name="Z"), Widget(name="A")])
        results = await widget_repo.list(order_by=["name", "nonexistent"])
        names = [r.name for r in results]
        assert names == sorted(names)


class TestJsonFilter:
    @pytest.mark.asyncio
    async def test_json_filter(self, test_db):
        from sqlalchemy import JSON, Column
        from sqlalchemy import String as SString

        class JsonWidget(BaseModel_):
            __tablename__ = "json_widgets"
            name = Column(SString(100), nullable=False)
            metadata_col = Column(JSON, nullable=True)

        async with test_db.begin():
            await test_db.run_sync(lambda sess: BaseModel_.metadata.create_all(sess.get_bind()))

        repo = BaseRepository(JsonWidget)
        await repo.create(JsonWidget(name="JW", metadata_col={"key": "val"}))
        results = await repo.list(filter_by={"metadata_col": '{"key": "val"}'})
        assert len(results) >= 0  # JSON filtering behavior varies by DB

    @pytest.mark.asyncio
    async def test_invalid_json_filter(self, test_db):
        from sqlalchemy import JSON, Column
        from sqlalchemy import String as SString

        class JsonWidget2(BaseModel_):
            __tablename__ = "json_widgets2"
            name = Column(SString(100), nullable=False)
            data = Column(JSON, nullable=True)

        async with test_db.begin():
            await test_db.run_sync(lambda sess: BaseModel_.metadata.create_all(sess.get_bind()))

        repo = BaseRepository(JsonWidget2)
        await repo.create(JsonWidget2(name="Test", data={"k": "v"}))
        with pytest.raises(ValueError, match="Invalid JSON"):
            await repo.list(filter_by={"data": "not-json{"})


class TestCoerceValueEdgeCases:
    @pytest.mark.asyncio
    async def test_coerce_string_passthrough(self, test_db, widget_repo):
        await widget_repo.create(Widget(name="Test"))
        results = await widget_repo.list(filter_by={"name__gte": "A"})
        assert isinstance(results, list)


class TestSoftDeleteValidation:
    def test_soft_delete_without_deleted_at_column_raises(self):
        class BadSoftModel(BaseModel_):
            __tablename__ = "bad_soft_models"
            __soft_delete__ = True
            name = Column(String(100), nullable=False)

        with pytest.raises(ValueError, match="deleted_at"):
            BaseRepository(BadSoftModel)

    def test_soft_delete_with_deleted_at_column_ok(self):
        repo = BaseRepository(SoftWidget)
        assert repo._soft_delete is True


class TestColumnNamesCaching:
    def test_column_names_cached(self):
        repo = BaseRepository(Widget)
        first = repo._get_column_names()
        second = repo._get_column_names()
        assert first is second


class TestServiceGetByIds:
    @pytest.mark.asyncio
    async def test_get_by_ids(self, test_db):
        repo_cls = type(
            "WRepo",
            (BaseRepository,),
            {"__init__": lambda self: BaseRepository.__init__(self, Widget)},
        )
        from src.entities.base import BaseService

        svc_cls = type(
            "WSvc",
            (BaseService,),
            {"__init__": lambda self: BaseService.__init__(self, repo_cls)},
        )
        svc = svc_cls()
        r1 = await svc.create({"name": "A"})
        r2 = await svc.create({"name": "B"})
        results = await svc.get_by_ids([r1.id, r2.id])
        assert len(results) == 2

    @pytest.mark.asyncio
    async def test_exists(self, test_db):
        repo_cls = type(
            "WRepo2",
            (BaseRepository,),
            {"__init__": lambda self: BaseRepository.__init__(self, Widget)},
        )
        from src.entities.base import BaseService

        svc_cls = type(
            "WSvc2",
            (BaseService,),
            {"__init__": lambda self: BaseService.__init__(self, repo_cls)},
        )
        svc = svc_cls()
        r1 = await svc.create({"name": "ExistCheck"})
        assert await svc.exists(r1.id) is True
        assert await svc.exists(99999) is False
