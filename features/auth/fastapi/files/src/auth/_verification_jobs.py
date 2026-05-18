import asyncio
import os
import uuid
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from typing import Any

from loguru import logger
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.configs import DatabaseConfig

from ._mailer import build_verification_link, send_verification_email
from ._models import RefreshToken, User, VerificationToken
from ._password import hash_token

VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60
REVOKED_RETENTION_DAYS = 30
DEFAULT_CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60


async def send_initial_verification_email(db_session: AsyncSession, user_id: str) -> dict[str, str]:
    user = (await db_session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        return {"status": "skipped_missing"}
    if user.deleted_at is not None:
        return {"status": "skipped_deleted"}
    if bool(user.email_verified):
        return {"status": "skipped_verified"}

    raw_token = f"{uuid.uuid4()}{uuid.uuid4()}"
    expires_at = datetime.now(UTC) + timedelta(seconds=VERIFICATION_TOKEN_TTL_SECONDS)
    db_session.add(
        VerificationToken(
            user_id=user.id,
            kind="email_verify",
            token_hash=hash_token(raw_token),
            expires_at=expires_at,
        )
    )
    await db_session.flush()

    link = build_verification_link(raw_token)
    try:
        sent = await send_verification_email(str(user.email), link)
        if not sent:
            logger.warning(f"[verification] SMTP not configured; email logged only user_id={user.id}")
    except Exception as exc:
        logger.error(f"[verification] send failed user_id={user.id} err={exc}")

    return {"status": "sent"}


async def cleanup_auth_artifacts(db_session: AsyncSession, now: datetime | None = None) -> dict[str, int]:
    current = now or datetime.now(UTC)
    revoked_cutoff = current - timedelta(days=REVOKED_RETENTION_DAYS)

    verification_result = await db_session.execute(
        delete(VerificationToken).where(
            or_(
                VerificationToken.expires_at < current,
                (VerificationToken.consumed_at.is_not(None)) & (VerificationToken.consumed_at < revoked_cutoff),
            )
        )
    )
    refresh_result = await db_session.execute(
        delete(RefreshToken).where(
            or_(
                RefreshToken.expires_at < current,
                (RefreshToken.revoked_at.is_not(None)) & (RefreshToken.revoked_at < revoked_cutoff),
            )
        )
    )
    await db_session.flush()

    verification_count = int(getattr(verification_result, "rowcount", 0) or 0)
    refresh_count = int(getattr(refresh_result, "rowcount", 0) or 0)
    if verification_count or refresh_count:
        logger.info(
            f"[cleanup] auth artifacts cleaned up | "
            f"expired_verification_tokens={verification_count} | "
            f"expired_refresh_tokens={refresh_count}"
        )
    return {
        "expired_verification_tokens": verification_count,
        "expired_refresh_tokens": refresh_count,
    }


_background_task: asyncio.Task[Any] | None = None


def _cleanup_interval_seconds() -> int:
    raw = os.getenv("AUTH_CLEANUP_INTERVAL_SECONDS")
    if not raw:
        return DEFAULT_CLEANUP_INTERVAL_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_CLEANUP_INTERVAL_SECONDS
    return value if value > 0 else DEFAULT_CLEANUP_INTERVAL_SECONDS


async def _cleanup_loop() -> None:
    interval = _cleanup_interval_seconds()
    while True:
        try:
            async with DatabaseConfig.async_session() as db_session:
                await cleanup_auth_artifacts(db_session)
                await db_session.commit()
        except Exception as exc:
            logger.error(f"[cleanup] job failed err={exc}")
        await asyncio.sleep(interval)


def start_verification_jobs() -> asyncio.Task[Any] | None:
    global _background_task
    if os.getenv("AUTH_BACKGROUND_JOBS", "true").strip().lower() == "false":
        return None
    if _background_task is not None and not _background_task.done():
        return _background_task
    _background_task = asyncio.create_task(_cleanup_loop())
    return _background_task


async def stop_verification_jobs() -> None:
    global _background_task
    if _background_task is None:
        return
    _background_task.cancel()
    with suppress(asyncio.CancelledError):
        await _background_task
    _background_task = None
