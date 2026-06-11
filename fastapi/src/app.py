from src import bootstrap as _bootstrap  # noqa: F401

import logging
import os
import sys
from contextlib import asynccontextmanager
from typing import Any, cast

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from loguru import logger
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from sqlalchemy import text
from src.entities import api_router
from src.exception_handlers import register_exception_handlers
from src.middlewares import (
    AuthenticationMiddleware,
    AuthorizationMiddleware,
    BodyLimitMiddleware,
    RequestIDMiddleware,
    SecurityHeadersMiddleware,
)

LOG_FORMAT = (
    "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
    "<level>{level: <8}</level> | "
    "<cyan>{extra[request_id]}</cyan> | "
    "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
    "<level>{message}</level>"
)

logger.remove()
logger.add(sys.stderr, format=LOG_FORMAT, level=os.getenv("LOG_LEVEL", "DEBUG"))
logger.configure(extra={"request_id": "-"})


class _UvicornInterceptHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        message = record.getMessage()
        level: str | int = record.levelname if logger.level(record.levelname, None) else record.levelno
        if "/health" in message:
            level = "DEBUG"
        logger.opt(depth=6, exception=record.exc_info).log(level, message)


for _name in ("uvicorn.access", "uvicorn.error", "uvicorn"):
    _logger = logging.getLogger(_name)
    _logger.handlers = [_UvicornInterceptHandler()]
    _logger.propagate = False


_ready = False


def _is_ready() -> bool:
    return _ready


def _set_ready(value: bool) -> None:
    global _ready
    _ready = value


_SHUTDOWN_DRAIN_SECONDS = float(os.getenv("SHUTDOWN_DRAIN_SECONDS", "5"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    from src._sentry import SENTRY_PURPOSE, init_sentry
    from src.entities.service_config import ServiceConfigRepository

    if init_sentry(await ServiceConfigRepository().get_config(SENTRY_PURPOSE)):
        logger.info("Sentry initialised from service config.")

    logger.info("Application started.")
    _set_ready(True)
    yield
    _set_ready(False)
    logger.info(
        f"Application shutting down; draining for {_SHUTDOWN_DRAIN_SECONDS}s so the LB can deregister.",
    )
    import asyncio

    from src.configs import DatabaseConfig

    await asyncio.sleep(_SHUTDOWN_DRAIN_SECONDS)
    try:
        await DatabaseConfig.dispose()
    except Exception as e:
        logger.warning(f"DatabaseConfig.close() failed during shutdown: {e}")
    logger.info("Application shutdown complete.")


EXPOSE_API_DOCS = os.getenv("EXPOSE_API_DOCS", "false").lower() == "true"

app = FastAPI(
    lifespan=lifespan,
    docs_url="/docs" if EXPOSE_API_DOCS else None,
    redoc_url="/redoc" if EXPOSE_API_DOCS else None,
    openapi_url="/openapi.json" if EXPOSE_API_DOCS else None,
)


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )

    components = openapi_schema.setdefault("components", {})
    security_schemes = components.setdefault("securitySchemes", {})
    security_schemes["BearerAuth"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "Paste only the raw JWT token; Swagger adds the 'Bearer ' prefix automatically.",
    }

    for path, methods in openapi_schema.get("paths", {}).items():
        if not path.startswith("/api/v1/"):
            continue
        for _, operation in methods.items():
            operation.setdefault("security", [{"BearerAuth": []}])

    app.openapi_schema = openapi_schema
    return app.openapi_schema


cast("Any", app).openapi = custom_openapi


def _rate_key(request: Request) -> str:
    auth = getattr(request.state, "auth_user", None)
    if auth and getattr(auth, "sub", None):
        return f"user:{auth.sub}"
    return f"ip:{get_remote_address(request)}"


_RATE_LIMIT = os.getenv("RATE_LIMIT", "200/minute")
limiter = Limiter(key_func=_rate_key, default_limits=[_RATE_LIMIT])
app.state.limiter = limiter
cast("Any", app).add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(AuthorizationMiddleware)
app.add_middleware(AuthenticationMiddleware)
app.add_middleware(BodyLimitMiddleware)
app.add_middleware(RequestIDMiddleware)

_DEFAULT_ALLOW_METHODS = "GET,POST,PATCH,PUT,DELETE,OPTIONS"
_DEFAULT_ALLOW_HEADERS = "Authorization,Content-Type,X-Request-Id,Idempotency-Key"

_cors_origins_env = os.getenv("CORS_ALLOW_ORIGINS")
if not _cors_origins_env:
    raise RuntimeError("CORS_ALLOW_ORIGINS is required (comma-separated list of allowed origins)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in _cors_origins_env.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=[m.strip() for m in os.getenv("CORS_ALLOW_METHODS", _DEFAULT_ALLOW_METHODS).split(",")],
    allow_headers=[h.strip() for h in os.getenv("CORS_ALLOW_HEADERS", _DEFAULT_ALLOW_HEADERS).split(",")],
)

register_exception_handlers(app)


@app.get("/api/health/live", tags=["Health Check"])
async def check_liveness():
    return {"status": "healthy"}


async def _readiness():
    from src.configs import DatabaseConfig
    from starlette.responses import JSONResponse

    checks = {"app": "ok" if _is_ready() else "draining"}
    if not _is_ready():
        return JSONResponse(status_code=503, content={"status": "unhealthy", "checks": checks})
    try:
        async with DatabaseConfig.get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        logger.error(f"readiness database check failed: {e}")
        checks["database"] = "error"
        return JSONResponse(status_code=503, content={"status": "unhealthy", "checks": checks})

    return {"status": "healthy", "checks": checks}


@app.get("/api/health/ready", tags=["Health Check"])
async def check_readiness():
    return await _readiness()


@app.get("/api/health", tags=["Health Check"])
async def check_health():
    return await _readiness()


# projx-anchor: routers
app.include_router(api_router, prefix="/api")
