from typing import Any

import sentry_sdk
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.httpx import HttpxIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

SENTRY_PURPOSE = "sentry"

_DEFAULT_ENVIRONMENT = "production"

_DROP_EXCEPTION_NAMES = {
    "BusinessRuleError",
    "NotFoundError",
    "RequestValidationError",
    "HTTPException",
    "AuthenticationError",
}

_DROP_TRANSACTION_PREFIXES = ("GET /api/health",)


def _before_send(event: Any, hint: dict[str, Any]) -> Any:
    exc_info = hint.get("exc_info") if hint else None
    if exc_info:
        exc = exc_info[1]
        if exc is not None:
            name = type(exc).__name__
            if name in _DROP_EXCEPTION_NAMES:
                return None
            status_code = getattr(exc, "status_code", None)
            if isinstance(status_code, int) and 400 <= status_code < 500:
                return None
    return event


def _before_send_transaction(event: Any, _hint: dict[str, Any]) -> Any:
    transaction = event.get("transaction")
    if isinstance(transaction, str) and transaction.startswith(_DROP_TRANSACTION_PREFIXES):
        return None
    return event


def init_sentry(config: dict[str, Any] | None) -> bool:
    dsn = str((config or {}).get("dsn", "")).strip()
    if not dsn:
        return False
    environment = str((config or {}).get("environment") or _DEFAULT_ENVIRONMENT)
    release = str((config or {}).get("release") or "") or None
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        server_name="backend",
        traces_sample_rate=0.0,
        send_default_pii=False,
        max_request_body_size="small",
        before_send=_before_send,
        before_send_transaction=_before_send_transaction,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            StarletteIntegration(transaction_style="endpoint"),
            AsyncioIntegration(),
            HttpxIntegration(),
            SqlalchemyIntegration(),
        ],
    )
    return True
