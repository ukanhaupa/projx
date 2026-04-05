import re
from fnmatch import fnmatch

from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from ._permission_resolvers import DefaultPermissionResolver, PermissionResolver
from ._public_paths import is_authn_only_path, is_public_path

_SAFE_PERMISSION_PATTERN = re.compile(r"^[a-z0-9_*:. ]+$")


async def compute_scope_filters(user, table_name: str, column_names: set[str]) -> dict | None:
    """Return row-level filters based on the user's scope, or None for unrestricted access.

    Override this function to implement row-level security. For example, return
    {"created_by": user.user_id} to restrict users to their own records.
    """
    return None


class AuthorizationMiddleware:
    def __init__(self, app: ASGIApp, permission_resolver: PermissionResolver | None = None):
        self.app = app
        self._permission_resolver = permission_resolver or DefaultPermissionResolver()

    _METHOD_ACTION_MAP = {
        "GET": "read",
        "POST": "create",
        "PUT": "update",
        "PATCH": "update",
        "DELETE": "delete",
    }

    def _build_permission_candidates(self, action: str, target_scope: str) -> set[str]:
        action_name = action.strip().lower()
        scope = target_scope.strip().lower()
        return {
            f"{action_name}.{scope}",
            f"{action_name}.*",
            f"*.{scope}",
            "*.*",
        }

    def _normalize_resource_name(self, value: str) -> str:
        return value.strip().lower().replace("-", "_")

    def _normalize_permission_string(self, value: str) -> str:
        permission = str(value).strip().lower()
        if not permission:
            return ""
        if ":" in permission:
            resource, action_scope = permission.split(":", 1)
            return f"{self._normalize_resource_name(resource)}:{action_scope.strip()}"
        if "." in permission:
            resource, action_scope = permission.split(".", 1)
            return f"{self._normalize_resource_name(resource)}:{action_scope.strip()}"
        return permission

    def _is_valid_resource_pattern(self, value: str) -> bool:
        if not value:
            return False
        if value == "*":
            return True
        return all(character.isalnum() or character == "_" for character in value)

    def _is_valid_permission_pattern(self, value: str) -> bool:
        permission = self._normalize_permission_string(value)
        if not permission or ":" not in permission:
            return False

        resource, action_scope = permission.split(":", 1)
        if not self._is_valid_resource_pattern(resource):
            return False
        if "." not in action_scope:
            return False

        action, scope = action_scope.split(".", 1)
        action_allowed = action in {"read", "create", "update", "delete", "*"}
        scope_allowed = scope in {"one", "all", "*"}
        return action_allowed and scope_allowed

    def _is_valid_map_method_pattern(self, value: str) -> bool:
        candidate = str(value).strip().lower()
        if not candidate or "." not in candidate:
            return False
        action, scope = candidate.split(".", 1)
        action_allowed = action in {"read", "create", "update", "delete", "*"}
        scope_allowed = scope in {"one", "all", "*"}
        return action_allowed and scope_allowed

    def _build_required_permission(self, path: str, method: str) -> tuple[str, str, str, str] | None:
        if not path.startswith("/api/v1/"):
            return None
        parts = path.strip("/").split("/")
        if len(parts) < 3:
            return None
        resource = parts[2].replace("-", "_")
        if method not in self._METHOD_ACTION_MAP:
            return None
        target_scope = "all"
        if method == "GET":
            if len(parts) >= 4:
                action = "read"
                target_scope = "one"
            else:
                action = "read"
                target_scope = "all"
        else:
            action = self._METHOD_ACTION_MAP[method]
            target_scope = "one"
        return resource, method, action, target_scope

    def _extract_permissions(self, payload: dict) -> tuple[list[str], dict[str, list[str]]]:
        raw_permissions = self._permission_resolver.extract_raw_permissions(payload)
        permissions_map = payload.get("permissions_map") or payload.get("permissions_by_resource") or {}
        if isinstance(payload.get("permissions"), dict):
            permissions_map = payload["permissions"]

        permissions = [
            self._normalize_permission_string(p)
            for p in raw_permissions
            if str(p).strip() and self._is_valid_permission_pattern(str(p))
        ]
        if not isinstance(permissions_map, dict):
            permissions_map = {}
        normalized_map: dict[str, list[str]] = {}
        for resource, methods in permissions_map.items():
            normalized_resource = self._normalize_resource_name(str(resource))
            if not self._is_valid_resource_pattern(normalized_resource):
                continue
            if isinstance(methods, list):
                normalized_values = [
                    str(m).strip().lower() for m in methods if self._is_valid_map_method_pattern(str(m))
                ]
                normalized_map[normalized_resource] = list(dict.fromkeys(normalized_values))
            elif methods is None:
                normalized_map[normalized_resource] = []
            elif isinstance(methods, dict):
                enabled_values = [
                    str(value).strip().lower()
                    for value, enabled in methods.items()
                    if bool(enabled) and self._is_valid_map_method_pattern(str(value))
                ]
                normalized_map[normalized_resource] = list(dict.fromkeys(enabled_values))
            else:
                normalized_map[normalized_resource] = (
                    [str(methods).strip().lower()] if self._is_valid_map_method_pattern(str(methods)) else []
                )
        return permissions, normalized_map

    def _has_permission(
        self,
        resource: str,
        candidates: set[str],
        permissions: list[str] | None = None,
        permissions_map: dict[str, list[str]] | None = None,
    ) -> bool:
        permissions = permissions or []
        permissions_map = permissions_map or {}
        normalized_resource = self._normalize_resource_name(resource)

        def has_map_permission(permissions_map: dict[str, list[str]]) -> bool:
            specific_methods = permissions_map.get(normalized_resource) or []
            wildcard_resource_methods = permissions_map.get("*") or []
            return (
                any(candidate in specific_methods for candidate in candidates)
                or "*" in specific_methods
                or any(candidate in wildcard_resource_methods for candidate in candidates)
                or "*" in wildcard_resource_methods
            )

        if has_map_permission(permissions_map):
            return True

        expected_permissions = [f"{normalized_resource}:{candidate}" for candidate in sorted(candidates)]
        return any(
            any(fnmatch(expected_permission, user_permission) for expected_permission in expected_permissions)
            for user_permission in permissions
            if _SAFE_PERMISSION_PATTERN.match(user_permission)
        )

    def _check_permission(
        self,
        resource: str,
        action: str,
        target_scope: str,
        permissions: list[str],
        permissions_map: dict[str, list[str]],
    ) -> bool:
        broad_candidates = self._build_permission_candidates(action, target_scope)
        return self._has_permission(
            resource,
            broad_candidates,
            permissions,
            permissions_map,
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope["path"]
        method = scope.get("method", "GET").upper()

        if is_public_path(path):
            await self.app(scope, receive, send)
            return
        if is_authn_only_path(path):
            await self.app(scope, receive, send)
            return

        required_permission = self._build_required_permission(path, method)
        if required_permission is None:
            if path.startswith("/api/v1/"):
                response = JSONResponse(
                    status_code=405,
                    content={"detail": "Method not allowed"},
                )
                await response(scope, receive, send)
                return
            await self.app(scope, receive, send)
            return

        state = scope.get("state", {})
        user = state.get("user")
        if user is None or user.user_id == "system":
            response = JSONResponse(
                status_code=401,
                content={"detail": "Authentication required"},
            )
            await response(scope, receive, send)
            return

        payload = state.get("jwt_payload") or {}
        permissions, permissions_map = self._extract_permissions(payload)
        resource, method, action, target_scope = required_permission
        has_permission = self._check_permission(
            resource,
            action,
            target_scope,
            permissions,
            permissions_map,
        )
        if not has_permission:
            response = JSONResponse(
                status_code=403,
                content={"detail": (f"Insufficient permissions: {resource}:{action}.{target_scope} required")},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
