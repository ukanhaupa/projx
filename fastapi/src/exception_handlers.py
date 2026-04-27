import sqlalchemy.exc
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from loguru import logger

from src.entities.base import BusinessRuleError, NotFoundError


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _body(detail: str, request: Request) -> dict[str, object]:
    body: dict[str, object] = {"detail": detail}
    rid = _request_id(request)
    if rid is not None:
        body["request_id"] = rid
    return body


async def _handle_not_found(request: Request, exc: NotFoundError) -> JSONResponse:
    logger.warning(f"NotFoundError on {request.method} {request.url.path}: {exc}")
    return JSONResponse(status_code=404, content=_body(str(exc), request))


async def _handle_business_rule(request: Request, exc: BusinessRuleError) -> JSONResponse:
    logger.warning(f"BusinessRuleError on {request.method} {request.url.path}: {exc.detail}")
    return JSONResponse(status_code=422, content=_body(exc.detail, request))


async def _handle_integrity(request: Request, exc: sqlalchemy.exc.IntegrityError) -> JSONResponse:
    logger.warning(f"IntegrityError on {request.method} {request.url.path}: {exc}")
    method = request.method.upper()
    if method == "DELETE":
        detail = "Cannot delete: resource is referenced by other records"
    elif method in {"PATCH", "PUT"}:
        detail = "Update violates a constraint"
    else:
        detail = "Resource already exists or violates a constraint"
    return JSONResponse(status_code=409, content=_body(detail, request))


async def _handle_bad_request(request: Request, exc: Exception) -> JSONResponse:
    logger.warning(f"{type(exc).__name__} on {request.method} {request.url.path}: {exc}")
    return JSONResponse(status_code=400, content=_body("Invalid request data", request))


async def _handle_unhandled(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(f"Unhandled {type(exc).__name__} on {request.method} {request.url.path}: {exc}")
    return JSONResponse(status_code=500, content=_body("Internal server error", request))


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(NotFoundError, _handle_not_found)  # type: ignore[arg-type]
    app.add_exception_handler(BusinessRuleError, _handle_business_rule)  # type: ignore[arg-type]
    app.add_exception_handler(sqlalchemy.exc.IntegrityError, _handle_integrity)  # type: ignore[arg-type]
    app.add_exception_handler(sqlalchemy.exc.SQLAlchemyError, _handle_bad_request)
    app.add_exception_handler(ValueError, _handle_bad_request)
    app.add_exception_handler(Exception, _handle_unhandled)
