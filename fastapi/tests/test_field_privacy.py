import pytest
from fastapi import APIRouter
from httpx import ASGITransport, AsyncClient
from sqlalchemy import Column, String

from src.app import app
from src.entities.base import (
    BaseModel_,
    BaseRepository,
    BaseService,
    EntityRegistry,
    create_create_schema,
    create_update_schema,
)
from src.entities.base._registry import _AutoController


class SecretWidget(BaseModel_):
    __tablename__ = "secret_widgets"
    __api_prefix__ = "/secret-widgets"
    __hidden_fields__ = {"internal_note"}

    name = Column(String(100), nullable=False)
    internal_note = Column(String(500), nullable=True)
    password_hash = Column(String(200), nullable=True)


class HiddenEntity(BaseModel_):
    __tablename__ = "hidden_entities"
    __api_prefix__ = "/hidden-entities"
    __private__ = True

    name = Column(String(100), nullable=False)


def _build_controller(model):
    repo_cls = type(
        f"{model.__name__}Repo",
        (BaseRepository,),
        {"__init__": lambda self: BaseRepository.__init__(self, model)},
    )
    svc_cls = type(
        f"{model.__name__}Service",
        (BaseService,),
        {"__init__": lambda self: BaseService.__init__(self, repo_cls)},
    )
    return _AutoController(
        svc_cls,
        create_create_schema(model),
        create_update_schema(model),
        bulk_operations=False,
    )


_secret_router = APIRouter(prefix="/api/v1/secret-widgets", tags=["test"])
_secret_router.include_router(_build_controller(SecretWidget).router)
app.include_router(_secret_router)


@pytest.fixture
async def http_client(test_db):
    from src.configs import get_db_session

    async def override():
        yield test_db

    app.dependency_overrides[get_db_session] = override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


class TestHiddenFieldsLeakViaAutoController:
    endpoint = "/api/v1/secret-widgets/"

    @pytest.mark.asyncio
    async def test_list_strips_explicitly_hidden_field(self, http_client, test_db, auth_headers_admin):
        test_db.add(SecretWidget(name="W1", internal_note="do-not-leak", password_hash="x"))
        await test_db.commit()

        resp = await http_client.get(self.endpoint, headers=auth_headers_admin)
        assert resp.status_code == 200, resp.text
        row = resp.json()["data"][0]
        assert "internal_note" not in row, f"explicit __hidden_fields__ leaked: {row}"

    @pytest.mark.asyncio
    async def test_get_strips_explicitly_hidden_field(self, http_client, test_db, auth_headers_admin):
        w = SecretWidget(name="W2", internal_note="do-not-leak", password_hash="x")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.get(f"{self.endpoint}{w.id}", headers=auth_headers_admin)
        assert resp.status_code == 200, resp.text
        assert "internal_note" not in resp.json()

    @pytest.mark.asyncio
    async def test_list_strips_built_in_private_column(self, http_client, test_db, auth_headers_admin):
        test_db.add(SecretWidget(name="W3", password_hash="hashed-secret"))
        await test_db.commit()

        resp = await http_client.get(self.endpoint, headers=auth_headers_admin)
        row = resp.json()["data"][0]
        assert "password_hash" not in row, f"built-in private column leaked: {row}"

    @pytest.mark.asyncio
    async def test_get_strips_built_in_private_column(self, http_client, test_db, auth_headers_admin):
        w = SecretWidget(name="W4", password_hash="hashed-secret")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.get(f"{self.endpoint}{w.id}", headers=auth_headers_admin)
        assert "password_hash" not in resp.json()

    @pytest.mark.asyncio
    async def test_create_response_strips_hidden_fields(self, http_client, auth_headers_admin):
        resp = await http_client.post(
            self.endpoint,
            json={"name": "W5", "internal_note": "secret", "password_hash": "h"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert "internal_note" not in body
        assert "password_hash" not in body


class TestEntityLevelPrivate:
    def test_private_entity_skipped_from_registry(self):
        EntityRegistry.reset()
        EntityRegistry.auto_discover()
        assert "hidden_entities" not in EntityRegistry._entities, (
            "entity with __private__=True should not be auto-discovered"
        )

    @pytest.mark.asyncio
    async def test_private_entity_not_in_meta(self, http_client, auth_headers_admin):
        resp = await http_client.get("/api/v1/_meta", headers=auth_headers_admin)
        assert resp.status_code == 200
        names = [e["table_name"] for e in resp.json()["entities"]]
        assert "hidden_entities" not in names

    @pytest.mark.asyncio
    async def test_private_entity_routes_not_registered(self, http_client, auth_headers_admin):
        resp = await http_client.get("/api/v1/hidden-entities/", headers=auth_headers_admin)
        assert resp.status_code == 404


class TestMetaStripsHiddenFields:
    @pytest.mark.asyncio
    async def test_meta_omits_explicit_hidden_field(self, http_client, auth_headers_admin):
        EntityRegistry.reset()
        EntityRegistry.auto_discover()
        resp = await http_client.get("/api/v1/_meta", headers=auth_headers_admin)
        assert resp.status_code == 200
        secret_widget = next(
            (e for e in resp.json()["entities"] if e["table_name"] == "secret_widgets"),
            None,
        )
        assert secret_widget is not None
        keys = [f["key"] for f in secret_widget["fields"]]
        assert "internal_note" not in keys
        assert "password_hash" not in keys
