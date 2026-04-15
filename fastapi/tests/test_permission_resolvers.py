from src.middlewares import DefaultPermissionResolver, OidcPermissionResolver


class TestDefaultPermissionResolver:
    resolver = DefaultPermissionResolver()

    def test_extract_list(self):
        result = self.resolver.extract_raw_permissions({"permissions": ["a:read.*", "b:write.*"]})
        assert result == ["a:read.*", "b:write.*"]

    def test_extract_empty(self):
        assert self.resolver.extract_raw_permissions({}) == []

    def test_extract_none(self):
        assert self.resolver.extract_raw_permissions({"permissions": None}) == []

    def test_extract_dict_returns_empty(self):
        assert self.resolver.extract_raw_permissions({"permissions": {"a": "b"}}) == []

    def test_extract_single_string(self):
        result = self.resolver.extract_raw_permissions({"permissions": "admin:*.*"})
        assert result == ["admin:*.*"]

    def test_extract_empty_string(self):
        assert self.resolver.extract_raw_permissions({"permissions": ""}) == []


class TestOidcPermissionResolver:
    resolver = OidcPermissionResolver()

    def test_basic_permissions(self):
        result = self.resolver.extract_raw_permissions({"permissions": ["perm1"]})
        assert "perm1" in result

    def test_resource_access_roles(self):
        payload = {
            "permissions": [],
            "resource_access": {
                "my-app": {"roles": ["admin", "editor"]},
                "other-app": {"roles": ["viewer"]},
            },
        }
        result = self.resolver.extract_raw_permissions(payload)
        assert "admin" in result
        assert "editor" in result
        assert "viewer" in result

    def test_realm_access_roles(self):
        payload = {
            "permissions": [],
            "realm_access": {"roles": ["realm-admin"]},
        }
        result = self.resolver.extract_raw_permissions(payload)
        assert "realm-admin" in result

    def test_resource_access_single_role(self):
        payload = {
            "permissions": [],
            "resource_access": {
                "app": {"roles": "single-role"},
            },
        }
        result = self.resolver.extract_raw_permissions(payload)
        assert "single-role" in result

    def test_realm_access_single_role(self):
        payload = {
            "permissions": [],
            "realm_access": {"roles": "single-realm-role"},
        }
        result = self.resolver.extract_raw_permissions(payload)
        assert "single-realm-role" in result

    def test_invalid_resource_access_entry(self):
        payload = {
            "permissions": [],
            "resource_access": {"app": "not-a-dict"},
        }
        result = self.resolver.extract_raw_permissions(payload)
        assert result == []

    def test_dict_permissions_returns_empty(self):
        result = self.resolver.extract_raw_permissions({"permissions": {"a": "b"}})
        assert isinstance(result, list)

    def test_combined_permissions_and_roles(self):
        payload = {
            "permissions": ["direct:read.*"],
            "resource_access": {"app": {"roles": ["app-admin"]}},
            "realm_access": {"roles": ["realm-user"]},
        }
        result = self.resolver.extract_raw_permissions(payload)
        assert "direct:read.*" in result
        assert "app-admin" in result
        assert "realm-user" in result

    def test_empty_payload(self):
        assert self.resolver.extract_raw_permissions({}) == []

    def test_none_roles(self):
        payload = {
            "permissions": [],
            "resource_access": {"app": {"roles": None}},
            "realm_access": {"roles": None},
        }
        result = self.resolver.extract_raw_permissions(payload)
        assert result == []
