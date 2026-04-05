from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


class BaseEntityApiTest:
    """Base test class for entity CRUD endpoints.

    Provides 11 test methods that cover create, list, get, update, delete,
    filtering, search, auth, and validation.

    Configure via class attributes:
        endpoint          - API URL (e.g. "/api/v1/users/")
        create_payload    - JSON body for create test
        update_payload    - JSON body for update test
        invalid_payload   - JSON body that should fail validation
        filter_field      - Column name to test filtering
        filter_value      - Value for filter tests
        other_filter_value - Second value for filter tests
        allow_create/update/delete - Set False for readonly entities

    Override behavior when customizing endpoints:
        assert_create_response(data, payload) - validate create response shape
        assert_list_response(data)            - validate list response shape
        assert_get_response(data, row)        - validate get response shape
        assert_update_response(data, payload) - validate update response shape
        make_model(index, **overrides)        - create a model instance for DB seeding
        build_create_payload()                - build create request body
        build_update_payload(row)             - build update request body
    """

    __test__ = False

    endpoint: str = ""
    create_payload: dict[str, Any] = {}
    update_payload: dict[str, Any] = {}
    invalid_payload: dict[str, Any] = {}
    filter_field: str = ""
    filter_value: Any = None
    other_filter_value: Any = None

    allow_create: bool = True
    allow_update: bool = True
    allow_delete: bool = True
    method_not_allowed_status: int = 405

    def make_model(self, index: int, **overrides):
        raise NotImplementedError

    def build_create_payload(self) -> dict[str, Any]:
        return dict(self.create_payload)

    def build_update_payload(self, row) -> dict[str, Any]:
        return dict(self.update_payload)

    # ── Assertion hooks — override these when you customize endpoint responses ──

    def assert_create_response(self, data: dict, payload: dict):
        """Validate the response from a successful create. Override for custom schemas."""
        for key, value in payload.items():
            assert data[key] == value
        assert "id" in data
        assert "created_at" in data

    def assert_list_response(self, data: dict):
        """Validate the response from a successful list. Override for custom formats."""
        assert "data" in data
        assert "pagination" in data
        assert len(data["data"]) >= 2
        assert data["pagination"]["total_records"] >= 2

    def assert_get_response(self, data: dict, row):
        """Validate the response from a successful get. Override for custom formats."""
        assert data["id"] == row.id

    def assert_update_response(self, data: dict, payload: dict):
        """Validate the response from a successful update. Override for custom schemas."""
        for key, value in payload.items():
            assert data[key] == value

    # ── Tests ────────────────────────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_create(
        self,
        client: AsyncClient,
        test_db: AsyncSession,
        auth_headers_admin: dict[str, str],
    ):
        payload = self.build_create_payload()
        response = await client.post(
            self.endpoint,
            json=payload,
            headers=auth_headers_admin,
        )

        if not self.allow_create:
            assert response.status_code == self.method_not_allowed_status, response.text
            return

        assert response.status_code == 201, response.text
        self.assert_create_response(response.json(), payload)

    @pytest.mark.asyncio
    async def test_list(
        self,
        client: AsyncClient,
        test_db: AsyncSession,
        auth_headers_admin: dict[str, str],
    ):
        first = self.make_model(1)
        second = self.make_model(2)
        test_db.add_all([first, second])
        await test_db.commit()

        response = await client.get(self.endpoint, headers=auth_headers_admin)

        assert response.status_code == 200, response.text
        self.assert_list_response(response.json())

    @pytest.mark.asyncio
    async def test_list_with_token_without_bearer_prefix(
        self,
        client: AsyncClient,
        auth_token_user: str,
    ):
        response = await client.get(
            self.endpoint,
            headers={"Authorization": auth_token_user},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_list_with_filtering(
        self,
        client: AsyncClient,
        test_db: AsyncSession,
        auth_headers_admin: dict[str, str],
    ):
        one = self.make_model(1, **{self.filter_field: self.filter_value})
        two = self.make_model(2, **{self.filter_field: self.other_filter_value})
        test_db.add_all([one, two])
        await test_db.commit()

        response = await client.get(
            f"{self.endpoint}?{self.filter_field}={self.filter_value}",
            headers=auth_headers_admin,
        )

        assert response.status_code == 200, response.text
        data = response.json()
        assert len(data["data"]) >= 1
        assert any(item[self.filter_field] == self.filter_value for item in data["data"])

    @pytest.mark.asyncio
    async def test_list_with_search(
        self,
        client: AsyncClient,
        test_db: AsyncSession,
        auth_headers_admin: dict[str, str],
    ):
        one = self.make_model(1, **{self.filter_field: self.filter_value})
        two = self.make_model(2, **{self.filter_field: self.other_filter_value})
        test_db.add_all([one, two])
        await test_db.commit()

        response = await client.get(
            self.endpoint,
            params={"search": str(self.filter_value)},
            headers=auth_headers_admin,
        )

        assert response.status_code == 200, response.text
        data = response.json()
        search_value = str(self.filter_value).lower()
        assert len(data["data"]) >= 1
        assert any(search_value in str(item).lower() for item in data["data"])

    @pytest.mark.asyncio
    async def test_get(
        self,
        client: AsyncClient,
        test_db: AsyncSession,
        auth_headers_admin: dict[str, str],
    ):
        row = self.make_model(1)
        test_db.add(row)
        await test_db.commit()
        await test_db.refresh(row)

        response = await client.get(f"{self.endpoint}{row.id}", headers=auth_headers_admin)

        assert response.status_code == 200, response.text
        self.assert_get_response(response.json(), row)

    @pytest.mark.asyncio
    async def test_get_not_found(
        self,
        client: AsyncClient,
        auth_headers_admin: dict[str, str],
    ):
        response = await client.get(f"{self.endpoint}99999", headers=auth_headers_admin)
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update(
        self,
        client: AsyncClient,
        test_db: AsyncSession,
        auth_headers_admin: dict[str, str],
    ):
        row = self.make_model(1)
        test_db.add(row)
        await test_db.commit()
        await test_db.refresh(row)

        payload = self.build_update_payload(row)
        response = await client.patch(
            f"{self.endpoint}{row.id}",
            json=payload,
            headers=auth_headers_admin,
        )

        if not self.allow_update:
            assert response.status_code == self.method_not_allowed_status, response.text
            return

        assert response.status_code == 200, response.text
        self.assert_update_response(response.json(), payload)

    @pytest.mark.asyncio
    async def test_delete(
        self,
        client: AsyncClient,
        test_db: AsyncSession,
        auth_headers_admin: dict[str, str],
    ):
        row = self.make_model(1)
        test_db.add(row)
        await test_db.commit()
        await test_db.refresh(row)

        response = await client.delete(f"{self.endpoint}{row.id}", headers=auth_headers_admin)

        if not self.allow_delete:
            assert response.status_code == self.method_not_allowed_status, response.text
            return

        assert response.status_code == 204

        verify = await client.get(f"{self.endpoint}{row.id}", headers=auth_headers_admin)
        assert verify.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_not_found(
        self,
        client: AsyncClient,
        auth_headers_admin: dict[str, str],
    ):
        response = await client.delete(f"{self.endpoint}99999", headers=auth_headers_admin)

        if not self.allow_delete:
            assert response.status_code == self.method_not_allowed_status, response.text
            return

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_validation_error(
        self,
        client: AsyncClient,
        auth_headers_admin: dict[str, str],
    ):
        response = await client.post(
            self.endpoint,
            json=self.invalid_payload,
            headers=auth_headers_admin,
        )

        if not self.allow_create:
            assert response.status_code in [
                self.method_not_allowed_status,
                422,
            ], response.text
            return

        assert response.status_code in [400, 422]
