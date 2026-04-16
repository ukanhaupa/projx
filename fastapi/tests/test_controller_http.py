import pytest
import sqlalchemy.exc
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from src.app import app
from src.entities.base import (
    BaseRepository,
    BaseService,
    BusinessRuleError,
    NotFoundError,
    create_create_schema,
    create_update_schema,
)

# Import to ensure model is registered with Base metadata
from tests.test_base_crud import SoftWidget, Widget

# ── Test model (reuse Widget from test_base_crud) ───────────────────


# ── Build a real controller + router for Widget ─────────────────────


def _build_widget_controller():
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

    from src.entities.base._registry import _AutoController

    return _AutoController(
        svc_cls,
        create_create_schema(Widget),
        create_update_schema(Widget),
        bulk_operations=True,
    )


def _build_soft_widget_controller():
    repo_cls = type(
        "SoftWidgetRepo",
        (BaseRepository,),
        {
            "__init__": lambda self: BaseRepository.__init__(self, SoftWidget),
        },
    )
    svc_cls: type[BaseService] = type(
        "SoftWidgetService",
        (BaseService,),
        {
            "__init__": lambda self: BaseService.__init__(self, repo_cls),
        },
    )

    from src.entities.base._registry import _AutoController

    return _AutoController(
        svc_cls,
        create_create_schema(SoftWidget),
        create_update_schema(SoftWidget),
        bulk_operations=False,
    )


# Mount routes once at module level
from fastapi import APIRouter

_widget_router = APIRouter(prefix="/api/v1/test-widgets", tags=["test"])
_ctrl = _build_widget_controller()
_widget_router.include_router(_ctrl.router)
app.include_router(_widget_router)


@pytest.fixture
async def http_client(test_db: AsyncSession):
    from src.configs import get_db_session

    async def override():
        yield test_db

    app.dependency_overrides[get_db_session] = override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── CRUD through HTTP ───────────────────────────────────────────────


class TestControllerHttp:
    endpoint = "/api/v1/test-widgets/"

    @pytest.mark.asyncio
    async def test_create(self, http_client, auth_headers_admin):
        resp = await http_client.post(
            self.endpoint,
            json={"name": "HttpWidget", "price": 5.0},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["name"] == "HttpWidget"
        assert "id" in data

    @pytest.mark.asyncio
    async def test_list(self, http_client, test_db, auth_headers_admin):
        test_db.add_all([Widget(name="H1"), Widget(name="H2")])
        await test_db.commit()

        resp = await http_client.get(self.endpoint, headers=auth_headers_admin)
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert "pagination" in data

    @pytest.mark.asyncio
    async def test_get(self, http_client, test_db, auth_headers_admin):
        w = Widget(name="GetMe")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.get(f"{self.endpoint}{w.id}", headers=auth_headers_admin)
        assert resp.status_code == 200
        assert resp.json()["id"] == w.id

    @pytest.mark.asyncio
    async def test_get_not_found(self, http_client, auth_headers_admin):
        resp = await http_client.get(f"{self.endpoint}99999", headers=auth_headers_admin)
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_patch(self, http_client, test_db, auth_headers_admin):
        w = Widget(name="Before")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.patch(
            f"{self.endpoint}{w.id}",
            json={"name": "After"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "After"

    @pytest.mark.asyncio
    async def test_patch_empty_body(self, http_client, test_db, auth_headers_admin):
        w = Widget(name="X")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.patch(
            f"{self.endpoint}{w.id}",
            json={},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_patch_not_found(self, http_client, auth_headers_admin):
        resp = await http_client.patch(
            f"{self.endpoint}99999",
            json={"name": "X"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete(self, http_client, test_db, auth_headers_admin):
        w = Widget(name="Gone")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.delete(f"{self.endpoint}{w.id}", headers=auth_headers_admin)
        assert resp.status_code == 204

    @pytest.mark.asyncio
    async def test_delete_not_found(self, http_client, auth_headers_admin):
        resp = await http_client.delete(f"{self.endpoint}99999", headers=auth_headers_admin)
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_validation_error(self, http_client, auth_headers_admin):
        resp = await http_client.post(
            self.endpoint,
            json={"bad_field": "value"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_search(self, http_client, test_db, auth_headers_admin):
        test_db.add_all([Widget(name="FindThis"), Widget(name="Other")])
        await test_db.commit()

        resp = await http_client.get(f"{self.endpoint}?search=Find", headers=auth_headers_admin)
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_filter(self, http_client, test_db, auth_headers_admin):
        test_db.add_all([Widget(name="Alpha"), Widget(name="Beta")])
        await test_db.commit()

        resp = await http_client.get(f"{self.endpoint}?name=Alpha", headers=auth_headers_admin)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert all(item["name"] == "Alpha" for item in data)

    @pytest.mark.asyncio
    async def test_bulk_create(self, http_client, auth_headers_admin):
        resp = await http_client.post(
            f"{self.endpoint}bulk",
            json=[{"name": "B1"}, {"name": "B2"}],
            headers=auth_headers_admin,
        )
        assert resp.status_code == 201
        assert resp.json()["count"] == 2

    @pytest.mark.asyncio
    async def test_order_by(self, http_client, test_db, auth_headers_admin):
        test_db.add_all([Widget(name="Z"), Widget(name="A")])
        await test_db.commit()

        resp = await http_client.get(f"{self.endpoint}?order_by=name", headers=auth_headers_admin)
        assert resp.status_code == 200
        names = [item["name"] for item in resp.json()["data"]]
        assert names == sorted(names)

    @pytest.mark.asyncio
    async def test_get_with_expand(self, http_client, test_db, auth_headers_admin):
        w = Widget(name="Expandable")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.get(
            f"{self.endpoint}{w.id}?expand=nonexistent",
            headers=auth_headers_admin,
        )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_list_with_expand(self, http_client, test_db, auth_headers_admin):
        test_db.add(Widget(name="ListExpand"))
        await test_db.commit()

        resp = await http_client.get(
            f"{self.endpoint}?expand=nonexistent",
            headers=auth_headers_admin,
        )
        assert resp.status_code == 200


# ── Scoped user tests (monkeypatch compute_scope_filters) ───────────


class TestControllerScoped:
    """Test controller with scope filters enabled."""

    endpoint = "/api/v1/test-widgets/"

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
    async def test_create_with_scope(self, http_client, auth_headers_admin):
        resp = await http_client.post(
            self.endpoint,
            json={"name": "ignored", "price": 1.0},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 201
        # scope filter overrides name to "scoped"
        assert resp.json()["name"] == "scoped"

    @pytest.mark.asyncio
    async def test_list_with_scope(self, http_client, test_db, auth_headers_admin):
        test_db.add_all([Widget(name="scoped"), Widget(name="other")])
        await test_db.commit()

        resp = await http_client.get(self.endpoint, headers=auth_headers_admin)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert all(item["name"] == "scoped" for item in data)

    @pytest.mark.asyncio
    async def test_get_with_scope(self, http_client, test_db, auth_headers_admin):
        w = Widget(name="scoped")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.get(f"{self.endpoint}{w.id}", headers=auth_headers_admin)
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_get_with_scope_not_found(self, http_client, test_db, auth_headers_admin):
        w = Widget(name="other")  # doesn't match scope filter "scoped"
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.get(f"{self.endpoint}{w.id}", headers=auth_headers_admin)
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_patch_with_scope(self, http_client, test_db, auth_headers_admin):
        w = Widget(name="scoped")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.patch(
            f"{self.endpoint}{w.id}",
            json={"price": 99.0},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_patch_with_scope_not_found(self, http_client, test_db, auth_headers_admin):
        w = Widget(name="other")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.patch(
            f"{self.endpoint}{w.id}",
            json={"price": 99.0},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_with_scope(self, http_client, test_db, auth_headers_admin):
        w = Widget(name="scoped")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.delete(f"{self.endpoint}{w.id}", headers=auth_headers_admin)
        assert resp.status_code == 204

    @pytest.mark.asyncio
    async def test_delete_with_scope_not_found(self, http_client, test_db, auth_headers_admin):
        w = Widget(name="other")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.delete(f"{self.endpoint}{w.id}", headers=auth_headers_admin)
        assert resp.status_code == 404


# ── Exception handler tests ─────────────────────────────────────────


class TestControllerErrors:
    """Hit exception handler paths in BaseController."""

    endpoint = "/api/v1/test-widgets/"

    @pytest.fixture(autouse=True)
    def _break_service(self, monkeypatch):
        """Make service methods raise to hit except branches."""
        pass

    # ── 400 Bad Request (ValueError, SQLAlchemyError) ────────────────

    @pytest.mark.asyncio
    async def test_create_value_error(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(data):
            raise ValueError("bad data")

        monkeypatch.setattr(_ctrl.service, "create", _fail)

        resp = await http_client.post(
            self.endpoint,
            json={"name": "test"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Invalid request data"

    @pytest.mark.asyncio
    async def test_list_value_error(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise ValueError("bad filter")

        monkeypatch.setattr(_ctrl.service, "list_with_count", _fail)

        resp = await http_client.get(self.endpoint, headers=auth_headers_admin)
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_get_sqlalchemy_error(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise sqlalchemy.exc.SQLAlchemyError("db issue")

        monkeypatch.setattr(_ctrl.service, "get", _fail)

        resp = await http_client.get(f"{self.endpoint}1", headers=auth_headers_admin)
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_patch_value_error(self, http_client, test_db, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise ValueError("bad field")

        monkeypatch.setattr(_ctrl.service, "patch", _fail)

        w = Widget(name="X")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.patch(
            f"{self.endpoint}{w.id}",
            json={"name": "Y"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_delete_sqlalchemy_error(self, http_client, test_db, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise sqlalchemy.exc.SQLAlchemyError("db issue")

        monkeypatch.setattr(_ctrl.service, "delete", _fail)

        w = Widget(name="X")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.delete(f"{self.endpoint}{w.id}", headers=auth_headers_admin)
        assert resp.status_code == 400

    # ── 404 Not Found (NotFoundError) ──────────────────────────────────

    @pytest.mark.asyncio
    async def test_create_not_found_error(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(data):
            raise NotFoundError("Widget", 1)

        monkeypatch.setattr(_ctrl.service, "create", _fail)

        resp = await http_client.post(
            self.endpoint,
            json={"name": "test"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_get_not_found_error(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise NotFoundError("Widget", 99999)

        monkeypatch.setattr(_ctrl.service, "get", _fail)

        resp = await http_client.get(f"{self.endpoint}1", headers=auth_headers_admin)
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_patch_not_found_error(self, http_client, test_db, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise NotFoundError("Widget", 99999)

        monkeypatch.setattr(_ctrl.service, "patch", _fail)

        w = Widget(name="X")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.patch(
            f"{self.endpoint}{w.id}",
            json={"name": "Y"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_not_found_error(self, http_client, test_db, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise NotFoundError("Widget", 99999)

        monkeypatch.setattr(_ctrl.service, "delete", _fail)

        w = Widget(name="X")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.delete(f"{self.endpoint}{w.id}", headers=auth_headers_admin)
        assert resp.status_code == 404

    # ── 409 Conflict (IntegrityError) ──────────────────────────────────

    @pytest.mark.asyncio
    async def test_create_integrity_error(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(data):
            raise sqlalchemy.exc.IntegrityError("INSERT", {}, Exception("UNIQUE constraint"))

        monkeypatch.setattr(_ctrl.service, "create", _fail)

        resp = await http_client.post(
            self.endpoint,
            json={"name": "duplicate"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 409
        assert "already exists" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_patch_integrity_error(self, http_client, test_db, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise sqlalchemy.exc.IntegrityError("UPDATE", {}, Exception("UNIQUE constraint"))

        monkeypatch.setattr(_ctrl.service, "patch", _fail)

        w = Widget(name="X")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.patch(
            f"{self.endpoint}{w.id}",
            json={"name": "Y"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 409
        assert "constraint" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_delete_integrity_error(self, http_client, test_db, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise sqlalchemy.exc.IntegrityError("DELETE", {}, Exception("FOREIGN KEY constraint"))

        monkeypatch.setattr(_ctrl.service, "delete", _fail)

        w = Widget(name="X")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.delete(f"{self.endpoint}{w.id}", headers=auth_headers_admin)
        assert resp.status_code == 409
        assert "referenced" in resp.json()["detail"]

    # ── 422 Unprocessable Entity (BusinessRuleError) ───────────────────

    @pytest.mark.asyncio
    async def test_create_business_rule_error(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(data):
            raise BusinessRuleError("Cannot create widget in archived category")

        monkeypatch.setattr(_ctrl.service, "create", _fail)

        resp = await http_client.post(
            self.endpoint,
            json={"name": "test"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 422
        assert "archived category" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_list_business_rule_error(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise BusinessRuleError("Export limit exceeded")

        monkeypatch.setattr(_ctrl.service, "list_with_count", _fail)

        resp = await http_client.get(self.endpoint, headers=auth_headers_admin)
        assert resp.status_code == 422
        assert "Export limit" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_get_business_rule_error(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise BusinessRuleError("Resource is under review")

        monkeypatch.setattr(_ctrl.service, "get", _fail)

        resp = await http_client.get(f"{self.endpoint}1", headers=auth_headers_admin)
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_patch_business_rule_error(self, http_client, test_db, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise BusinessRuleError("Cannot modify a locked record")

        monkeypatch.setattr(_ctrl.service, "patch", _fail)

        w = Widget(name="X")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.patch(
            f"{self.endpoint}{w.id}",
            json={"name": "Y"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 422
        assert "locked record" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_delete_business_rule_error(self, http_client, test_db, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise BusinessRuleError("Cannot delete an active subscription")

        monkeypatch.setattr(_ctrl.service, "delete", _fail)

        w = Widget(name="X")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.delete(f"{self.endpoint}{w.id}", headers=auth_headers_admin)
        assert resp.status_code == 422
        assert "active subscription" in resp.json()["detail"]

    # ── 500 Internal Server Error (unexpected Exception) ───────────────

    @pytest.mark.asyncio
    async def test_list_exception(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise RuntimeError("unexpected")

        monkeypatch.setattr(_ctrl.service, "list_with_count", _fail)

        resp = await http_client.get(self.endpoint, headers=auth_headers_admin)
        assert resp.status_code == 500
        assert resp.json()["detail"] == "Internal server error"

    @pytest.mark.asyncio
    async def test_get_exception(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise RuntimeError("unexpected")

        monkeypatch.setattr(_ctrl.service, "get", _fail)

        resp = await http_client.get(f"{self.endpoint}1", headers=auth_headers_admin)
        assert resp.status_code == 500

    @pytest.mark.asyncio
    async def test_patch_exception(self, http_client, test_db, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise RuntimeError("unexpected")

        monkeypatch.setattr(_ctrl.service, "patch", _fail)

        w = Widget(name="X")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.patch(
            f"{self.endpoint}{w.id}",
            json={"name": "Y"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 500

    @pytest.mark.asyncio
    async def test_delete_exception(self, http_client, test_db, auth_headers_admin, monkeypatch):
        async def _fail(*a, **kw):
            raise RuntimeError("unexpected")

        monkeypatch.setattr(_ctrl.service, "delete", _fail)

        w = Widget(name="X")
        test_db.add(w)
        await test_db.commit()
        await test_db.refresh(w)

        resp = await http_client.delete(f"{self.endpoint}{w.id}", headers=auth_headers_admin)
        assert resp.status_code == 500

    @pytest.mark.asyncio
    async def test_create_exception(self, http_client, auth_headers_admin, monkeypatch):
        async def _fail(data):
            raise RuntimeError("unexpected")

        monkeypatch.setattr(_ctrl.service, "create", _fail)

        resp = await http_client.post(
            self.endpoint,
            json={"name": "test"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 500
