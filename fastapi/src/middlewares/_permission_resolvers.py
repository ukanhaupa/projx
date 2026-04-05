from abc import ABC, abstractmethod


class PermissionResolver(ABC):
    @abstractmethod
    def extract_raw_permissions(self, payload: dict) -> list[str]: ...


class DefaultPermissionResolver(PermissionResolver):
    def extract_raw_permissions(self, payload: dict) -> list[str]:
        permissions = payload.get("permissions") or []
        if isinstance(permissions, dict):
            return []
        if not isinstance(permissions, list):
            return [permissions] if permissions else []
        return list(permissions)


class KeycloakPermissionResolver(PermissionResolver):
    def extract_raw_permissions(self, payload: dict) -> list[str]:
        permissions = payload.get("permissions") or []
        if isinstance(permissions, dict):
            permissions = []
        if not isinstance(permissions, list):
            permissions = [permissions] if permissions else []

        keycloak_roles: list[str] = []
        resource_access = payload.get("resource_access")
        if isinstance(resource_access, dict):
            for resource_info in resource_access.values():
                if not isinstance(resource_info, dict):
                    continue
                resource_roles = resource_info.get("roles") or []
                if isinstance(resource_roles, list):
                    keycloak_roles.extend(str(role) for role in resource_roles)
                elif resource_roles:
                    keycloak_roles.append(str(resource_roles))

        realm_access = payload.get("realm_access")
        if isinstance(realm_access, dict):
            realm_roles = realm_access.get("roles") or []
            if isinstance(realm_roles, list):
                keycloak_roles.extend(str(role) for role in realm_roles)
            elif realm_roles:
                keycloak_roles.append(str(realm_roles))

        return [*permissions, *keycloak_roles]
