import os

from dotenv import load_dotenv

# ===========================
# !!! ATTENTION !!!
# KEEP THIS AT THE TOP TO ENSURE ENVIRONMENT VARIABLES ARE LOADED BEFORE ANY IMPORTS
# ===========================
load_dotenv()

import sys
from contextlib import asynccontextmanager
from typing import Any, cast

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from loguru import logger
from sqlalchemy import text
from src.entities import api_router
from src.middlewares import (
    AuthenticationMiddleware,
    AuthorizationMiddleware,
    RequestIDMiddleware,
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Application started.")
    yield
    logger.info("Application shutdown.")


app = FastAPI(lifespan=lifespan)


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


app.add_middleware(AuthorizationMiddleware)
app.add_middleware(AuthenticationMiddleware)
app.add_middleware(RequestIDMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip() for origin in os.getenv("CORS_ALLOW_ORIGINS", "http://localhost, http://127.0.0.1").split(",")
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["Health Check"])
async def check_health():
    from src.configs import DatabaseConfig

    checks = {"app": "ok"}
    try:
        async with DatabaseConfig.get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {e}"
        from starlette.responses import JSONResponse

        return JSONResponse(status_code=503, content={"status": "unhealthy", "checks": checks})

    return {"status": "healthy", "checks": checks}


app.include_router(api_router, prefix="/api")
