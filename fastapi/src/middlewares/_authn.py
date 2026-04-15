from fastapi.responses import JSONResponse
from loguru import logger
from starlette.types import ASGIApp, Receive, Scope, Send

from src.configs import JWTVerificationError, verify_jwt_token

from ._public_paths import is_public_path
from ._user_context import (
    build_user_context_from_payload,
    set_current_user,
)


class AuthenticationMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    def _extract_bearer_token(self, authorization_header: str) -> str:
        if not authorization_header:
            return ""
        raw = authorization_header.strip()
        if not raw:
            return ""
        if " " not in raw:
            return ""
        scheme, token = raw.split(" ", 1)
        if scheme.lower() != "bearer":
            return ""
        token = token.strip()
        if token.lower().startswith("bearer "):
            return ""
        return token

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope["path"]

        if is_public_path(path):
            await self.app(scope, receive, send)
            return

        headers = dict((k.decode("latin-1"), v.decode("latin-1")) for k, v in scope.get("headers", []))
        token = self._extract_bearer_token(headers.get("authorization", ""))

        if token:
            try:
                payload = verify_jwt_token(token)
            except JWTVerificationError as exc:
                logger.debug(f"JWT verification failed ({exc.code}): {exc}")
                response = JSONResponse(
                    status_code=401,
                    content={"detail": "Invalid or expired token"},
                )
                await response(scope, receive, send)
                return
            except Exception as exc:
                logger.exception(f"Unexpected error during JWT verification: {exc}")
                response = JSONResponse(
                    status_code=401,
                    content={"detail": "Authentication failed"},
                )
                await response(scope, receive, send)
                return
        else:
            if path.startswith("/api/v1/"):
                response = JSONResponse(
                    status_code=401,
                    content={"detail": "Authentication required"},
                )
                await response(scope, receive, send)
                return
            payload = {}

        scope.setdefault("state", {})
        scope["state"]["jwt_payload"] = payload
        user_context = build_user_context_from_payload(payload)
        if user_context is None:
            scope["state"]["user"] = None
            set_current_user(None)
        else:
            set_current_user(user_context)
            scope["state"]["user"] = user_context

        try:
            if user_context:
                method = scope.get("method", "")
                logger.debug(f"Authenticated request: {method} {path} by {user_context.user_id}")
            else:
                method = scope.get("method", "")
                logger.debug(f"Unauthenticated request: {method} {path}")
            await self.app(scope, receive, send)
        finally:
            set_current_user(None)
