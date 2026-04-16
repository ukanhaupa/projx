from typing import Any, cast

from src.middlewares import AuthorizationMiddleware


class TestAuthzPermissionLogic:
    """Test the authorization logic without HTTP — pure unit tests."""

    authz = AuthorizationMiddleware(app=cast("Any", None))

    # ── normalize ────────────────────────────────────────────────────

    def test_normalize_resource_name(self):
        assert self.authz._normalize_resource_name("my-resource") == "my_resource"
        assert self.authz._normalize_resource_name("  Users  ") == "users"

    def test_normalize_permission_string_colon(self):
        assert self.authz._normalize_permission_string("Users:read.all") == "users:read.all"

    def test_normalize_permission_string_dot(self):
        assert self.authz._normalize_permission_string("users.read.all") == "users:read.all"

    def test_normalize_permission_string_empty(self):
        assert self.authz._normalize_permission_string("") == ""

    def test_normalize_permission_no_separator(self):
        assert self.authz._normalize_permission_string("admin") == "admin"

    # ── validation ───────────────────────────────────────────────────

    def test_valid_resource_pattern(self):
        assert self.authz._is_valid_resource_pattern("users") is True
        assert self.authz._is_valid_resource_pattern("*") is True
        assert self.authz._is_valid_resource_pattern("") is False
        assert self.authz._is_valid_resource_pattern("us-ers") is False

    def test_valid_permission_pattern(self):
        assert self.authz._is_valid_permission_pattern("users:read.all") is True
        assert self.authz._is_valid_permission_pattern("*:*.*") is True
        assert self.authz._is_valid_permission_pattern("users:read") is False
        assert self.authz._is_valid_permission_pattern("") is False
        assert self.authz._is_valid_permission_pattern("users:invalid.all") is False
        assert self.authz._is_valid_permission_pattern("users:read.invalid") is False

    def test_valid_map_method_pattern(self):
        assert self.authz._is_valid_map_method_pattern("read.all") is True
        assert self.authz._is_valid_map_method_pattern("*.*") is True
        assert self.authz._is_valid_map_method_pattern("read") is False
        assert self.authz._is_valid_map_method_pattern("") is False
        assert self.authz._is_valid_map_method_pattern("hack.all") is False

    # ── build required permission ────────────────────────────────────

    def test_build_required_permission_list(self):
        result = self.authz._build_required_permission("/api/v1/users", "GET")
        assert result == ("users", "GET", "read", "all")

    def test_build_required_permission_get_one(self):
        result = self.authz._build_required_permission("/api/v1/users/123", "GET")
        assert result == ("users", "GET", "read", "one")

    def test_build_required_permission_post(self):
        result = self.authz._build_required_permission("/api/v1/users", "POST")
        assert result == ("users", "POST", "create", "one")

    def test_build_required_permission_patch(self):
        result = self.authz._build_required_permission("/api/v1/users/1", "PATCH")
        assert result == ("users", "PATCH", "update", "one")

    def test_build_required_permission_delete(self):
        result = self.authz._build_required_permission("/api/v1/users/1", "DELETE")
        assert result == ("users", "DELETE", "delete", "one")

    def test_build_required_permission_non_api(self):
        assert self.authz._build_required_permission("/docs", "GET") is None

    def test_build_required_permission_short_path(self):
        assert self.authz._build_required_permission("/api/v1", "GET") is None

    def test_build_required_permission_unknown_method(self):
        assert self.authz._build_required_permission("/api/v1/users", "OPTIONS") is None

    def test_build_required_permission_hyphen_resource(self):
        result = self.authz._build_required_permission("/api/v1/audit-logs", "GET")
        assert result is not None
        assert result[0] == "audit_logs"

    # ── build permission candidates ──────────────────────────────────

    def test_build_permission_candidates(self):
        candidates = self.authz._build_permission_candidates("read", "all")
        assert "read.all" in candidates
        assert "read.*" in candidates
        assert "*.all" in candidates
        assert "*.*" in candidates

    # ── extract permissions ──────────────────────────────────────────

    def test_extract_permissions_list(self):
        perms, _pmap = self.authz._extract_permissions(
            {
                "permissions": ["users:read.all", "*:*.*"],
            }
        )
        assert "users:read.all" in perms
        assert "*:*.*" in perms

    def test_extract_permissions_filters_invalid(self):
        perms, _ = self.authz._extract_permissions(
            {
                "permissions": ["valid:read.all", "invalid", ""],
            }
        )
        assert "valid:read.all" in perms
        assert len(perms) == 1

    def test_extract_permissions_map(self):
        _, pmap = self.authz._extract_permissions(
            {
                "permissions": [],
                "permissions_map": {"users": ["read.all", "create.one"]},
            }
        )
        assert "read.all" in pmap["users"]
        assert "create.one" in pmap["users"]

    def test_extract_permissions_map_dict_format(self):
        _, pmap = self.authz._extract_permissions(
            {
                "permissions": {"users": ["read.all"]},
            }
        )
        assert "read.all" in pmap["users"]

    def test_extract_permissions_map_none_methods(self):
        _, pmap = self.authz._extract_permissions(
            {
                "permissions": [],
                "permissions_map": {"users": None},
            }
        )
        assert pmap["users"] == []

    def test_extract_permissions_map_dict_methods(self):
        _, pmap = self.authz._extract_permissions(
            {
                "permissions": [],
                "permissions_map": {"users": {"read.all": True, "delete.one": False}},
            }
        )
        assert "read.all" in pmap["users"]
        assert "delete.one" not in pmap["users"]

    def test_extract_permissions_map_single_method(self):
        _, pmap = self.authz._extract_permissions(
            {
                "permissions": [],
                "permissions_map": {"users": "read.all"},
            }
        )
        assert "read.all" in pmap["users"]

    def test_extract_permissions_map_normalizes_resource(self):
        _, pmap = self.authz._extract_permissions(
            {
                "permissions": [],
                "permissions_map": {"us-ers": ["read.all"]},
            }
        )
        assert "us-ers" not in pmap
        assert "us_ers" in pmap

    def test_extract_permissions_map_invalid_method_filtered(self):
        _, pmap = self.authz._extract_permissions(
            {
                "permissions": [],
                "permissions_map": {"users": ["read.all", "hack.all", "invalid"]},
            }
        )
        assert "read.all" in pmap["users"]
        assert len(pmap["users"]) == 1

    def test_extract_permissions_map_not_dict(self):
        _, pmap = self.authz._extract_permissions(
            {
                "permissions": [],
                "permissions_map": "invalid",
            }
        )
        assert pmap == {}

    # ── has_permission ───────────────────────────────────────────────

    def test_has_permission_wildcard(self):
        candidates = self.authz._build_permission_candidates("read", "all")
        assert self.authz._has_permission("users", candidates, permissions=["*:*.*"])

    def test_has_permission_specific(self):
        candidates = self.authz._build_permission_candidates("read", "all")
        assert self.authz._has_permission("users", candidates, permissions=["users:read.all"])

    def test_has_permission_denied(self):
        candidates = self.authz._build_permission_candidates("delete", "one")
        assert not self.authz._has_permission("users", candidates, permissions=["users:read.all"])

    def test_has_permission_via_map(self):
        candidates = self.authz._build_permission_candidates("read", "all")
        assert self.authz._has_permission(
            "users",
            candidates,
            permissions_map={"users": ["read.all"]},
        )

    def test_has_permission_via_map_wildcard_resource(self):
        candidates = self.authz._build_permission_candidates("read", "all")
        assert self.authz._has_permission(
            "users",
            candidates,
            permissions_map={"*": ["read.all"]},
        )

    def test_has_permission_via_map_wildcard_method(self):
        candidates = self.authz._build_permission_candidates("read", "all")
        assert self.authz._has_permission(
            "users",
            candidates,
            permissions_map={"users": ["*"]},
        )

    # ── check_permission (combines all) ──────────────────────────────

    def test_check_permission_granted(self):
        assert self.authz._check_permission(
            "users",
            "read",
            "all",
            permissions=["users:read.all"],
            permissions_map={},
        )

    def test_check_permission_denied(self):
        assert not self.authz._check_permission(
            "users",
            "delete",
            "one",
            permissions=["users:read.all"],
            permissions_map={},
        )
