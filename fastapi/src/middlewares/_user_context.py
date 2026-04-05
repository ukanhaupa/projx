import re
from contextvars import ContextVar
from dataclasses import dataclass

from loguru import logger

_USER_ID_PATTERN = re.compile(r"^[A-Za-z0-9_@.\-]{1,64}$")


@dataclass
class UserContext:
    user_id: str
    email: str | None = None


_current_user: ContextVar[UserContext] = ContextVar(
    "current_user",
    default=UserContext(user_id="system"),
)


def set_current_user(user_context: UserContext | None) -> None:
    if user_context is None:
        value = UserContext(user_id="system")
    else:
        candidate = user_context.user_id.strip() if user_context.user_id else ""
        if candidate and _USER_ID_PATTERN.fullmatch(candidate):
            value = user_context
        else:
            logger.warning(f"Invalid user identifier from token: '{user_context.user_id}'. Falling back to 'system'.")
            value = UserContext(user_id="system")
    _current_user.set(value)


def get_current_user() -> UserContext:
    return _current_user.get()


def build_user_context_from_payload(payload: dict | None) -> UserContext | None:
    if not isinstance(payload, dict):
        return None
    user_id = (
        payload.get("email")
        or payload.get("sub")
        or payload.get("user")
        or payload.get("user_id")
        or payload.get("username")
    )
    if not user_id:
        return None
    return UserContext(user_id=user_id, email=payload.get("email"))
