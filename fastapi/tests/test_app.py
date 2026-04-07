import pytest
from httpx import AsyncClient


class TestHealthCheck:
    @pytest.mark.asyncio
    async def test_healthy(self, client: AsyncClient):
        response = await client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["checks"]["app"] == "ok"
        assert data["checks"]["database"] == "ok"


class TestOpenAPI:
    @pytest.mark.asyncio
    async def test_openapi_schema(self, client: AsyncClient):
        response = await client.get("/openapi.json")
        assert response.status_code == 200
        schema = response.json()
        assert "components" in schema
        assert "BearerAuth" in schema["components"]["securitySchemes"]

    @pytest.mark.asyncio
    async def test_api_routes_have_security(self, client: AsyncClient):
        response = await client.get("/openapi.json")
        schema = response.json()
        for path, methods in schema.get("paths", {}).items():
            if path.startswith("/api/v1/"):
                for method, operation in methods.items():
                    assert "security" in operation, f"Missing security on {method} {path}"


class TestAuthMiddleware:
    @pytest.mark.asyncio
    async def test_public_docs_accessible(self, client: AsyncClient):
        response = await client.get("/docs")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_api_without_token_returns_401(self, client: AsyncClient):
        response = await client.get("/api/v1/audit-logs/")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_api_with_invalid_token_returns_401(self, client: AsyncClient):
        response = await client.get(
            "/api/v1/audit-logs/",
            headers={"Authorization": "Bearer bad.token.here"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_bearer_prefix_missing(self, client: AsyncClient, auth_token_admin):
        response = await client.get(
            "/api/v1/audit-logs/",
            headers={"Authorization": auth_token_admin},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_double_bearer_prefix(self, client: AsyncClient, auth_token_admin):
        response = await client.get(
            "/api/v1/audit-logs/",
            headers={"Authorization": f"Bearer Bearer {auth_token_admin}"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_wrong_scheme(self, client: AsyncClient, auth_token_admin):
        response = await client.get(
            "/api/v1/audit-logs/",
            headers={"Authorization": f"Basic {auth_token_admin}"},
        )
        assert response.status_code == 401


class TestAuthorizationMiddleware:
    @pytest.mark.asyncio
    async def test_user_can_read(self, client: AsyncClient, auth_headers_user):
        response = await client.get("/api/v1/audit-logs/", headers=auth_headers_user)
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_user_cannot_create(self, client: AsyncClient, auth_headers_user):
        response = await client.post(
            "/api/v1/audit-logs/",
            json={"table_name": "test"},
            headers=auth_headers_user,
        )
        # audit_log is readonly so 405, but user also lacks create permission → 403
        assert response.status_code in [403, 405]

    @pytest.mark.asyncio
    async def test_admin_full_access(self, client: AsyncClient, auth_headers_admin):
        response = await client.get("/api/v1/audit-logs/", headers=auth_headers_admin)
        assert response.status_code == 200


class TestMetaEndpoint:
    @pytest.mark.asyncio
    async def test_meta_returns_entities(self, client: AsyncClient, auth_headers_admin):
        response = await client.get("/api/v1/_meta", headers=auth_headers_admin)
        assert response.status_code == 200
        data = response.json()
        assert "entities" in data
        assert len(data["entities"]) >= 1

    @pytest.mark.asyncio
    async def test_meta_entity_fields(self, client: AsyncClient, auth_headers_admin):
        response = await client.get("/api/v1/_meta", headers=auth_headers_admin)
        entity = response.json()["entities"][0]
        assert "name" in entity
        assert "api_prefix" in entity
        assert "fields" in entity
        assert "readonly" in entity

    @pytest.mark.asyncio
    async def test_meta_requires_auth(self, client: AsyncClient):
        response = await client.get("/api/v1/_meta")
        assert response.status_code == 401


class TestAuthnMiddlewareEdgeCases:
    @pytest.mark.asyncio
    async def test_auth_disabled_bypasses_checks(self, client: AsyncClient, monkeypatch):
        monkeypatch.setenv("AUTH_ENABLED", "false")
        response = await client.get("/api/v1/audit-logs/")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_empty_auth_header(self, client: AsyncClient):
        response = await client.get(
            "/api/v1/audit-logs/",
            headers={"Authorization": ""},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_non_api_path_without_token(self, client: AsyncClient):
        response = await client.get("/api/health")
        assert response.status_code == 200


class TestEntityRegistry:
    def test_auto_discover_finds_entities(self):
        from src.entities.base import EntityRegistry

        entities = EntityRegistry.get_entities()
        assert len(entities) >= 1
        assert "audit_logs" in entities

    def test_entity_meta_has_fields(self):
        from src.entities.base import EntityRegistry

        entities = EntityRegistry.get_entities()
        meta = entities["audit_logs"]
        assert meta.name == "AuditLog"
        assert meta.readonly is True
        assert len(meta.fields) > 0

    def test_reset_clears_entities(self):
        from src.entities.base import EntityRegistry

        saved = dict(EntityRegistry._entities)
        EntityRegistry.reset()
        assert EntityRegistry._entities == {}
        # Restore
        EntityRegistry._entities = saved

    def test_auto_discover_reimport(self):
        from src.entities.base import EntityRegistry

        saved = dict(EntityRegistry._entities)
        EntityRegistry.reset()
        EntityRegistry.auto_discover()
        assert "audit_logs" in EntityRegistry._entities
        EntityRegistry._entities = saved

    @pytest.mark.asyncio
    async def test_meta_endpoint_response_shape(self, client: AsyncClient, auth_headers_admin):
        from src.entities.base import EntityRegistry

        result = await EntityRegistry._meta_endpoint()
        assert "entities" in result
        entity = result["entities"][0]
        assert "name" in entity
        assert "table_name" in entity
        assert "api_prefix" in entity
        assert "readonly" in entity
        assert "soft_delete" in entity
        assert "bulk_operations" in entity
        assert "fields" in entity


class TestRegistryValidation:
    def test_import_all_entity_modules(self):
        from src.entities.base import EntityRegistry

        EntityRegistry._import_all_entity_modules()
        # Should have found AuditLog's custom model
        assert len(EntityRegistry._entities) >= 1

    def test_skips_invalid_prefix(self):
        """Models with invalid __api_prefix__ are skipped."""
        from sqlalchemy import Column, String

        from src.entities.base import BaseModel_, EntityRegistry

        class BadPrefixModel(BaseModel_):
            __tablename__ = "bad_prefix_test"
            __api_prefix__ = "no-leading-slash"
            name = Column(String(50))

        saved = dict(EntityRegistry._entities)
        EntityRegistry._entities = {}
        EntityRegistry.auto_discover()
        assert "bad_prefix_test" not in EntityRegistry._entities
        EntityRegistry._entities = saved

    def test_skips_soft_delete_without_column(self):
        """Models with __soft_delete__=True but no deleted_at column are skipped."""
        from sqlalchemy import Column, String

        from src.entities.base import BaseModel_, EntityRegistry

        class BadSoftDeleteModel(BaseModel_):
            __tablename__ = "bad_soft_delete_test"
            __soft_delete__ = True
            name = Column(String(50))

        saved = dict(EntityRegistry._entities)
        EntityRegistry._entities = {}
        EntityRegistry.auto_discover()
        assert "bad_soft_delete_test" not in EntityRegistry._entities
        EntityRegistry._entities = saved

    def test_readonly_entity_only_exposes_get_routes(self):
        from src.app import app
        from src.entities.base import EntityRegistry

        readonly_entities = [(name, meta) for name, meta in EntityRegistry._entities.items() if meta.readonly]
        if not readonly_entities:
            pytest.skip("no readonly entities registered")

        write_methods = {"POST", "PUT", "PATCH", "DELETE"}

        for name, _meta in readonly_entities:
            kebab = name.replace("_", "-")
            observed_methods: set[str] = set()
            for route in app.routes:
                path = getattr(route, "path", "")
                if f"/{name}" in path or f"/{kebab}" in path:
                    observed_methods.update(getattr(route, "methods", set()) or set())

            if observed_methods:
                assert observed_methods.isdisjoint(write_methods), (
                    f"readonly entity {name} should not expose write routes, got {observed_methods & write_methods}"
                )


class TestDatabaseConfig:
    @pytest.mark.asyncio
    async def test_async_session_yields_session(self, test_db):
        from src.configs import DatabaseConfig

        async with DatabaseConfig.async_session() as session:
            assert session is not None
            assert "user" in session.info

    def test_missing_db_uri_raises(self, monkeypatch):
        from src.configs import _database as db_mod

        saved_engine = db_mod._engine
        db_mod._engine = None
        monkeypatch.delenv("SQLALCHEMY_DATABASE_URI", raising=False)
        try:
            with pytest.raises(RuntimeError, match="SQLALCHEMY_DATABASE_URI"):
                from src.configs import DatabaseConfig

                DatabaseConfig.get_engine()
        finally:
            db_mod._engine = saved_engine
