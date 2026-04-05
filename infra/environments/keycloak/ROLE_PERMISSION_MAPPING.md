# Keycloak Role Mapping

This file documents the role and permission structure used in the Keycloak realm template.
Customize `realm.template.json.tftpl`, `groups.common.json`, and `dev-users.json` to match
your project's access model.

## Roles

Roles defined in `realm.template.json.tftpl` — replace with your own:

- `admin` → full platform access
- Add your own domain-specific roles here

## Token claims expected by backend

- Roles from `realm_access.roles` and `resource_access.<client>.roles`
- Optional `permissions` claim for fine-grained access control

## Scaling strategy for large schemas

Use wildcard/domain patterns instead of per-resource permissions:

- `resource*:*.*` — full access to a resource family
- `resource*:read.*` — read-only on a resource family
- `domain*:*.*` — full access to a domain
