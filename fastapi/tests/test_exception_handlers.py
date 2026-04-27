import pytest
import sqlalchemy.exc
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.entities.base import BusinessRuleError, NotFoundError
from src.exception_handlers import register_exception_handlers
from src.middlewares import RequestIDMiddleware


def _make_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)
    register_exception_handlers(app)

    @app.get("/integrity")
    async def integrity():
        raise sqlalchemy.exc.IntegrityError("stmt", {}, Exception("uniq"))

    @app.delete("/integrity")
    async def integrity_delete():
        raise sqlalchemy.exc.IntegrityError("stmt", {}, Exception("fk"))

    @app.patch("/integrity")
    async def integrity_patch():
        raise sqlalchemy.exc.IntegrityError("stmt", {}, Exception("uniq"))

    @app.get("/not-found")
    async def not_found():
        raise NotFoundError("User", "abc-123")

    @app.get("/business-rule")
    async def business_rule():
        raise BusinessRuleError("Cannot delete a shipped order")

    @app.get("/sqla-error")
    async def sqla_error():
        raise sqlalchemy.exc.SQLAlchemyError("bad")

    @app.get("/value-error")
    async def value_error():
        raise ValueError("bad input")

    @app.get("/unexpected")
    async def unexpected():
        raise RuntimeError("something broke")

    return app


@pytest.fixture
async def client():
    app = _make_app()
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def test_integrity_post_returns_409_with_already_exists(client):
    res = await client.get("/integrity")
    assert res.status_code == 409
    body = res.json()
    assert "already exists" in body["detail"]
    assert body["request_id"]


async def test_integrity_delete_returns_409_with_referenced_message(client):
    res = await client.delete("/integrity")
    assert res.status_code == 409
    body = res.json()
    assert "referenced" in body["detail"]
    assert body["request_id"]


async def test_integrity_patch_returns_409_with_update_message(client):
    res = await client.patch("/integrity")
    assert res.status_code == 409
    body = res.json()
    assert "Update violates" in body["detail"]
    assert body["request_id"]


async def test_not_found_error_returns_404(client):
    res = await client.get("/not-found")
    assert res.status_code == 404
    body = res.json()
    assert "User" in body["detail"]
    assert "abc-123" in body["detail"]
    assert body["request_id"]


async def test_business_rule_error_returns_422(client):
    res = await client.get("/business-rule")
    assert res.status_code == 422
    body = res.json()
    assert body["detail"] == "Cannot delete a shipped order"
    assert body["request_id"]


async def test_generic_sqlalchemy_error_returns_400(client):
    res = await client.get("/sqla-error")
    assert res.status_code == 400
    body = res.json()
    assert body["detail"] == "Invalid request data"
    assert body["request_id"]


async def test_value_error_returns_400(client):
    res = await client.get("/value-error")
    assert res.status_code == 400
    body = res.json()
    assert body["detail"] == "Invalid request data"
    assert body["request_id"]


async def test_unexpected_exception_returns_500(client):
    res = await client.get("/unexpected")
    assert res.status_code == 500
    body = res.json()
    assert body["detail"] == "Internal server error"
    assert body["request_id"]


async def test_x_request_id_header_propagates_into_body(client):
    res = await client.get("/not-found", headers={"x-request-id": "test-rid-12345"})
    assert res.json()["request_id"] == "test-rid-12345"
    assert res.headers.get("x-request-id") == "test-rid-12345"
