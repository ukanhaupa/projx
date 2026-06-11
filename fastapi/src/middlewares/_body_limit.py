import os

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

__all__ = ["BodyLimitMiddleware"]


def _resolve_limit() -> int:
    raw = os.getenv("MAX_BODY_BYTES", "1048576")
    try:
        value = int(raw)
    except ValueError:
        value = 1048576
    return max(0, value)


class BodyLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_bytes: int | None = None) -> None:
        super().__init__(app)
        self.max_bytes = max_bytes if max_bytes is not None else _resolve_limit()

    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                size = int(content_length)
            except ValueError:
                size = 0
            if self.max_bytes and size > self.max_bytes:
                return JSONResponse(
                    status_code=413,
                    content={"detail": "request body too large"},
                )
        return await call_next(request)
