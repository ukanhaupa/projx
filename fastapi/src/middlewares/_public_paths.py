_PUBLIC_PREFIXES = ("/docs", "/redoc", "/openapi.json")

_AUTHN_ONLY_PREFIXES = ("/api/v1/_meta",)
_PUBLIC_EXACT = ("/api/", "/api/health")


def is_public_path(path: str) -> bool:
    return path in _PUBLIC_EXACT or path.startswith(_PUBLIC_PREFIXES)


def is_authn_only_path(path: str) -> bool:
    return path.startswith(_AUTHN_ONLY_PREFIXES)
