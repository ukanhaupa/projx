_PUBLIC_PREFIXES: tuple[str, ...] = (
    "/docs",
    "/redoc",
    "/openapi.json",
    # projx-anchor: public-prefixes
)

_AUTHN_ONLY_PREFIXES: tuple[str, ...] = (
    # projx-anchor: authn-only-prefixes
)
_PUBLIC_EXACT: tuple[str, ...] = (
    "/api/",
    "/api/health",
    "/api/health/live",
    "/api/health/ready",
    # projx-anchor: public-exact
)


def is_public_path(path: str) -> bool:
    return path in _PUBLIC_EXACT or path.startswith(_PUBLIC_PREFIXES)


def is_authn_only_path(path: str) -> bool:
    return any(p and path.startswith(p) for p in _AUTHN_ONLY_PREFIXES)
