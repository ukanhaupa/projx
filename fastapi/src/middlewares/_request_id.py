import uuid

from loguru import logger
from starlette.types import ASGIApp, Receive, Scope, Send


class RequestIDMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Extract or generate request ID
        headers = dict((k.decode("latin-1").lower(), v.decode("latin-1")) for k, v in scope.get("headers", []))
        request_id = headers.get("x-request-id") or uuid.uuid4().hex[:16]

        # Store in scope for handler access
        scope.setdefault("state", {})
        scope["state"]["request_id"] = request_id

        # Bind to loguru for log correlation
        with logger.contextualize(request_id=request_id):

            async def send_with_request_id(message):
                if message["type"] == "http.response.start":
                    headers = list(message.get("headers", []))
                    headers.append((b"x-request-id", request_id.encode()))
                    message["headers"] = headers
                await send(message)

            await self.app(scope, receive, send_with_request_id)
