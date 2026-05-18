import hashlib
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from ._models import RefreshToken, User

REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60
ACCESS_TTL_SECONDS = 15 * 60
MFA_CHALLENGE_TTL_SECONDS = 5 * 60

ROLE_PERMISSIONS: dict[str, list[str]] = {
    "admin": ["*:*.*"],
    "user": ["*:read.*"],
}


def permissions_for_role(role: str) -> list[str]:
    return list(ROLE_PERMISSIONS.get(role, []))


def _jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise RuntimeError("JWT_SECRET is required to issue tokens")
    return secret


def _jwt_algorithm() -> str:
    raw = os.getenv("JWT_ALGORITHMS", "HS256").split(",")
    return raw[0].strip() or "HS256"


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _sign(payload: dict[str, Any], expires_in_seconds: int) -> str:
    now = datetime.now(UTC)
    full = {
        **payload,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in_seconds)).timestamp()),
    }
    return jwt.encode(full, _jwt_secret(), algorithm=_jwt_algorithm())


def sign_mfa_challenge(user_id: str) -> str:
    return _sign({"sub": user_id, "stage": "mfa_pending"}, MFA_CHALLENGE_TTL_SECONDS)


def verify_mfa_challenge(token: str) -> dict[str, Any]:
    return jwt.decode(token, _jwt_secret(), algorithms=[_jwt_algorithm()])


def sign_tokens(payload: dict[str, Any]) -> dict[str, str]:
    access_jti = str(uuid.uuid4())
    refresh_jti = str(uuid.uuid4())
    access_token = _sign(
        {**payload, "token_type": "access", "jti": access_jti},
        ACCESS_TTL_SECONDS,
    )
    refresh_token = _sign(
        {**payload, "token_type": "refresh", "jti": refresh_jti},
        REFRESH_TTL_SECONDS,
    )
    return {
        "token": access_token,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "access_jti": access_jti,
        "refresh_jti": refresh_jti,
    }


def _serialize_user(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "last_login": user.last_login,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }


async def issue_auth_session(
    session: AsyncSession,
    user: User,
    ip_address: str | None,
    user_agent: str | None,
) -> dict[str, Any]:
    session_id = str(uuid.uuid4())
    payload = {
        "sub": user.id,
        "sid": session_id,
        "role": user.role,
        "email": user.email,
        "name": user.name,
        "permissions": permissions_for_role(str(user.role)),
    }
    tokens = sign_tokens(payload)
    expires_at = datetime.now(UTC) + timedelta(seconds=REFRESH_TTL_SECONDS)
    refresh_row = RefreshToken(
        user_id=user.id,
        session_id=session_id,
        token_hash=hash_refresh_token(tokens["refresh_token"]),
        expires_at=expires_at,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    session.add(refresh_row)
    await session.flush()
    return {
        "user": _serialize_user(user),
        "token": tokens["token"],
        "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
    }
