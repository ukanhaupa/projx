import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import Column, ForeignKey, Integer, String, Text
from sqlalchemy.ext.asyncio import AsyncSession

from src.app import app
from src.entities.base import (
    BaseModel_,
    BaseRepository,
    BaseService,
    EntityRegistry,
    create_create_schema,
    create_update_schema,
)
from src.entities.base._registry import _AutoController, _ReadOnlyController

from .test_base_crud import Widget


class ReadOnlyWidget(BaseModel_):
    __tablename__ = "readonly_widgets"
    __readonly__ = True
    __searchable_fields__ = {"name"}

    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    parent_id = Column(Integer, ForeignKey("readonly_widgets.id"), nullable=True)


def _build_readonly_controller():
    repo_cls = type(
        "ROWidgetRepo",
        (BaseRepository,),
        {"__init__": lambda self: BaseRepository.__init__(self, ReadOnlyWidget)},
    )
    svc_cls = type(
        "ROWidgetService",
        (BaseService,),
        {"__init__": lambda self: BaseService.__init__(self, repo_cls)},
    )
    return _ReadOnlyController(svc_cls)


def _build_auto_controller():
    repo_cls = type(
        "AutoWidgetRepo",
        (BaseRepository,),
        {"__init__": lambda self: BaseRepository.__init__(self, Widget)},
    )
    svc_cls = type(
        "AutoWidgetService",
        (BaseService,),
        {"__init__": lambda self: BaseService.__init__(self, repo_cls)},
    )
    return _AutoController(
        svc_cls,
        create_create_schema(Widget),
        create_update_schema(Widget),
        bulk_operations=True,
    )


from fastapi import APIRouter

_ro_router = APIRouter(prefix="/api/v1/test-ro-widgets", tags=["test"])
_ro_ctrl = _build_readonly_controller()
_ro_router.include_router(_ro_ctrl.router)
app.include_router(_ro_router)

_auto_router2 = APIRouter(prefix="/api/v1/test-auto-widgets2", tags=["test"])
_auto_ctrl2 = _build_auto_controller()
_auto_router2.include_router(_auto_ctrl2.router)
app.include_router(_auto_router2)


@pytest.fixture
async def http_client(test_db: AsyncSession):
    from src.configs import get_db_session

    async def override():
        yield test_db

    app.dependency_overrides[get_db_session] = override
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


class TestReadOnlyControllerHttp:
    endpoint = "/api/v1/test-ro-widgets/"

    @pytest.mark.asyncio
    async def test_list_empty(self, http_client, auth_headers_admin):
        resp = await http_client.get(self.endpoint, headers=auth_headers_admin)
        assert resp.status_code == 200
        data = resp.json()
        assert data["pagination"]["total_pages"] == 0
        assert data["pagination"]["total_records"] == 0

    @pytest.mark.asyncio
    async def test_list_with_data(self, http_client, test_db, auth_headers_admin):
        test_db.add_all([ReadOnlyWidget(name="A"), ReadOnlyWidget(name="B")])
        await test_db.commit()
        resp = await http_client.get(self.endpoint, headers=auth_headers_admin)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["data"]) >= 2

    @pytest.mark.asyncio
    async def test_get_found(self, http_client, test_db, auth_headers_admin):
        w = ReadOnlyWidget(name="GetMe")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)
        resp = await http_client.get(f"{self.endpoint}{w.id}", headers=auth_headers_admin)
        assert resp.status_code == 200
        assert resp.json()["name"] == "GetMe"

    @pytest.mark.asyncio
    async def test_get_not_found(self, http_client, auth_headers_admin):
        resp = await http_client.get(f"{self.endpoint}99999", headers=auth_headers_admin)
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_get_with_expand(self, http_client, test_db, auth_headers_admin):
        parent = ReadOnlyWidget(name="Parent")
        test_db.add(parent)
        await test_db.commit()
        await test_db.refresh(parent)

        child = ReadOnlyWidget(name="Child", parent_id=parent.id)
        test_db.add(child)
        await test_db.commit()
        await test_db.refresh(child)

        resp = await http_client.get(
            f"{self.endpoint}{child.id}?expand=parent",
            headers=auth_headers_admin,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["parent"]["name"] == "Parent"

    @pytest.mark.asyncio
    async def test_list_with_expand(self, http_client, test_db, auth_headers_admin):
        parent = ReadOnlyWidget(name="ExpandParent")
        test_db.add(parent)
        await test_db.commit()
        await test_db.refresh(parent)

        child = ReadOnlyWidget(name="ExpandChild", parent_id=parent.id)
        test_db.add(child)
        await test_db.commit()

        resp = await http_client.get(
            f"{self.endpoint}?expand=parent",
            headers=auth_headers_admin,
        )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_list_value_error(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise ValueError("bad filter")

        monkeypatch.setattr(_ro_ctrl.service, "list_with_count", _fail)
        resp = await http_client.get(self.endpoint, headers=auth_headers_admin)
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_list_unexpected_error(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise RuntimeError("unexpected")

        monkeypatch.setattr(_ro_ctrl.service, "list_with_count", _fail)
        resp = await http_client.get(self.endpoint, headers=auth_headers_admin)
        assert resp.status_code == 500

    @pytest.mark.asyncio
    async def test_get_unexpected_error(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise RuntimeError("unexpected")

        monkeypatch.setattr(_ro_ctrl.service, "get", _fail)
        resp = await http_client.get(f"{self.endpoint}1", headers=auth_headers_admin)
        assert resp.status_code == 500

    @pytest.mark.asyncio
    async def test_post_returns_405(self, http_client, auth_headers_admin):
        resp = await http_client.post(self.endpoint, json={"name": "test"}, headers=auth_headers_admin)
        assert resp.status_code == 405

    @pytest.mark.asyncio
    async def test_list_with_search(self, http_client, test_db, auth_headers_admin):
        test_db.add_all([ReadOnlyWidget(name="Findable"), ReadOnlyWidget(name="Other")])
        await test_db.commit()
        resp = await http_client.get(f"{self.endpoint}?search=Findable", headers=auth_headers_admin)
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_list_with_filter(self, http_client, test_db, auth_headers_admin):
        test_db.add_all([ReadOnlyWidget(name="FilterMe"), ReadOnlyWidget(name="Other")])
        await test_db.commit()
        resp = await http_client.get(f"{self.endpoint}?name=FilterMe", headers=auth_headers_admin)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert all(d["name"] == "FilterMe" for d in data)

    @pytest.mark.asyncio
    async def test_list_business_rule_error(self, http_client, auth_headers_admin, monkeypatch):
        from src.entities.base import BusinessRuleError

        async def _fail(*a, **kw):
            raise BusinessRuleError("limit exceeded")

        monkeypatch.setattr(_ro_ctrl.service, "list_with_count", _fail)
        resp = await http_client.get(self.endpoint, headers=auth_headers_admin)
        assert resp.status_code == 422


class TestAutoControllerBulkOps:
    endpoint = "/api/v1/test-auto-widgets2/"

    @pytest.mark.asyncio
    async def test_bulk_create(self, http_client, auth_headers_admin):
        resp = await http_client.post(
            f"{self.endpoint}bulk",
            json=[{"name": "BC1"}, {"name": "BC2"}],
            headers=auth_headers_admin,
        )
        assert resp.status_code == 201
        assert resp.json()["count"] == 2

    @pytest.mark.asyncio
    async def test_bulk_create_integrity_error(self, http_client, auth_headers_admin, monkeypatch):
        import sqlalchemy.exc

        async def _fail(items):
            raise sqlalchemy.exc.IntegrityError("INSERT", {}, Exception("UNIQUE"))

        monkeypatch.setattr(_auto_ctrl2.service, "bulk_create", _fail)
        resp = await http_client.post(
            f"{self.endpoint}bulk",
            json=[{"name": "dup"}],
            headers=auth_headers_admin,
        )
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_bulk_create_business_rule_error(self, http_client, auth_headers_admin, monkeypatch):
        from src.entities.base import BusinessRuleError

        async def _fail(items):
            raise BusinessRuleError("limit")

        monkeypatch.setattr(_auto_ctrl2.service, "bulk_create", _fail)
        resp = await http_client.post(
            f"{self.endpoint}bulk",
            json=[{"name": "x"}],
            headers=auth_headers_admin,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_bulk_create_value_error(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(items):
            raise ValueError("bad data")

        monkeypatch.setattr(_auto_ctrl2.service, "bulk_create", _fail)
        resp = await http_client.post(
            f"{self.endpoint}bulk",
            json=[{"name": "x"}],
            headers=auth_headers_admin,
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_bulk_create_unexpected_error(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(items):
            raise RuntimeError("unexpected")

        monkeypatch.setattr(_auto_ctrl2.service, "bulk_create", _fail)
        resp = await http_client.post(
            f"{self.endpoint}bulk",
            json=[{"name": "x"}],
            headers=auth_headers_admin,
        )
        assert resp.status_code == 500


class TestAutoControllerBulkScoped:
    endpoint = "/api/v1/test-auto-widgets2/"

    @pytest.fixture(autouse=True)
    def _enable_scope_filters(self, monkeypatch):
        async def _scoped_filters(user, table_name, column_names):
            if "name" in column_names:
                return {"name": "scoped"}
            return None

        monkeypatch.setattr(
            "src.entities.base._controller.compute_scope_filters",
            _scoped_filters,
        )

    @pytest.mark.asyncio
    async def test_bulk_create_with_scope(self, http_client, auth_headers_admin):
        resp = await http_client.post(
            f"{self.endpoint}bulk",
            json=[{"name": "ignored"}],
            headers=auth_headers_admin,
        )
        assert resp.status_code == 201
        assert resp.json()["data"][0]["name"] == "scoped"


class TestEntityRegistryEdgeCases:
    def test_meta_endpoint_includes_searchable_fields(self):
        entities = EntityRegistry.get_entities()
        meta = entities.get("audit_logs")
        assert meta is not None
        assert len(meta.searchable_fields) > 0

    @pytest.mark.asyncio
    async def test_meta_endpoint_returns_searchable_fields(self, http_client, auth_headers_admin):
        resp = await http_client.get("/api/v1/_meta", headers=auth_headers_admin)
        assert resp.status_code == 200
        data = resp.json()
        for entity in data["entities"]:
            assert "searchable_fields" in entity

    def test_build_auto_controller(self):
        entities = EntityRegistry.get_entities()
        for _tn, meta in entities.items():
            if not meta.readonly:
                ctrl = EntityRegistry._build_controller(meta)
                assert isinstance(ctrl, _AutoController)
                return
        pytest.skip("No writable entities found")

    def test_build_readonly_controller(self):
        entities = EntityRegistry.get_entities()
        for _tn, meta in entities.items():
            if meta.readonly:
                ctrl = EntityRegistry._build_controller(meta)
                assert isinstance(ctrl, _ReadOnlyController)
                return
        pytest.skip("No readonly entities found")
