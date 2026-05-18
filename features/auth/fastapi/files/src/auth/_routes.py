import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from loguru import logger
from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.configs import get_db_session

from ._mailer import (
    build_reset_link,
    build_verification_link,
    send_password_reset_email,
    send_verification_email,
)
from ._mfa import (
    MFA_LOCKOUT_MINUTES,
    MFA_MAX_ATTEMPTS,
    build_otpauth_url,
    decrypt_recovery_codes,
    decrypt_secret,
    encrypt_recovery_codes,
    encrypt_secret,
    generate_recovery_codes,
    generate_secret,
    hash_recovery_codes,
    is_mfa_locked,
    match_recovery_code,
    verify_totp,
)
from ._models import RefreshToken, User, VerificationToken
from ._password import hash_password, hash_token, verify_password
from ._schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    LogoutRequest,
    MfaChallengeRequest,
    MfaDisableRequest,
    MfaEnrollVerifyRequest,
    MfaRegenerateRequest,
    RefreshRequest,
    ResendVerificationRequest,
    ResetPasswordRequest,
    SignupRequest,
    VerifyEmailRequest,
)
from ._session import (
    REFRESH_TTL_SECONDS,
    hash_refresh_token,
    issue_auth_session,
    permissions_for_role,
    sign_mfa_challenge,
    sign_tokens,
    verify_mfa_challenge,
)
from ._verification_jobs import send_initial_verification_email

RESET_TOKEN_TTL_SECONDS = 30 * 60
VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60
LOGIN_MAX_ATTEMPTS = 5
LOGIN_LOCKOUT_MINUTES = 15


router = APIRouter(prefix="/auth", tags=["auth"])


def _now() -> datetime:
    return datetime.now(UTC)


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _err(
    request: Request,
    status_code: int,
    detail: str,
    extra: dict[str, Any] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {"detail": detail}
    rid = _request_id(request)
    if rid is not None:
        body["request_id"] = rid
    if extra:
        body.update(extra)
    return JSONResponse(status_code=status_code, content=body)


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip() or None
    if request.client is not None:
        return request.client.host
    return None


def _user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _auth_payload(request: Request) -> dict[str, Any] | None:
    state = getattr(request, "state", None)
    if state is None:
        return None
    payload = getattr(state, "jwt_payload", None)
    if isinstance(payload, dict) and payload:
        return payload
    return None


def _auth_user_id(request: Request) -> str | None:
    payload = _auth_payload(request)
    if not payload:
        return None
    sub = payload.get("sub")
    return str(sub) if sub else None


def _auth_session_id(request: Request) -> str | None:
    payload = _auth_payload(request)
    if not payload:
        return None
    sid = payload.get("sid")
    return str(sid) if isinstance(sid, str) and sid else None


def _serialize_session_user(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "last_login": user.last_login,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }


async def _get_user_by_id(db_session: AsyncSession, user_id: str) -> User | None:
    result = await db_session.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def _get_user_by_email(db_session: AsyncSession, email: str) -> User | None:
    result = await db_session.execute(select(User).where(User.email == email.lower()))
    return result.scalar_one_or_none()


async def _count_users(db_session: AsyncSession) -> int:
    from sqlalchemy import func

    result = await db_session.execute(select(func.count()).select_from(User))
    return int(result.scalar_one())


async def _record_mfa_failure(db_session: AsyncSession, user: User) -> None:
    next_count = int(user.mfa_failed_count or 0) + 1
    values: dict[str, Any] = {"mfa_failed_count": next_count}
    if next_count >= MFA_MAX_ATTEMPTS:
        values["mfa_locked_until"] = _now() + timedelta(minutes=MFA_LOCKOUT_MINUTES)
    await db_session.execute(update(User).where(User.id == user.id).values(**values))
    await db_session.flush()


async def _reset_mfa_counters(db_session: AsyncSession, user_id: str) -> None:
    await db_session.execute(update(User).where(User.id == user_id).values(mfa_failed_count=0, mfa_locked_until=None))
    await db_session.flush()


def _minutes_until(target: datetime) -> int:
    delta_ms = (target.astimezone(UTC) - _now()).total_seconds()
    minutes = int(delta_ms // 60)
    if delta_ms % 60 > 0:
        minutes += 1
    return max(minutes, 1)


@router.post("/signup")
async def signup(
    request: Request,
    body: SignupRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    existing = await _get_user_by_email(db_session, body.email)
    if existing is not None:
        return _err(request, 409, "An account with this email already exists.")
    password_hash = hash_password(body.password)
    is_first = (await _count_users(db_session)) == 0
    user = User(
        email=body.email.lower(),
        name=body.name,
        password_hash=password_hash,
        role="admin" if is_first else "user",
    )
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)

    session = await issue_auth_session(
        db_session,
        user,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
    )

    try:
        await send_initial_verification_email(db_session, str(user.id))
    except Exception as exc:
        logger.error(f"Failed to send initial verification email user_id={user.id} err={exc}")

    await db_session.commit()

    return JSONResponse(
        status_code=201,
        content={
            "user": {
                "id": str(user.id),
                "email": user.email,
                "name": user.name,
                "role": user.role,
                "last_login": user.last_login.isoformat() if user.last_login else None,
                "created_at": user.created_at.isoformat(),
                "updated_at": user.updated_at.isoformat(),
            },
            "token": session["token"],
            "access_token": session["access_token"],
            "refresh_token": session["refresh_token"],
        },
    )


@router.post("/login")
async def login(
    request: Request,
    body: LoginRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    user = await _get_user_by_email(db_session, body.email)

    if user is not None and user.locked_until is not None and user.locked_until.astimezone(UTC) > _now():
        mins = _minutes_until(user.locked_until)  # type: ignore[arg-type]
        suffix = "" if mins == 1 else "s"
        return _err(
            request,
            429,
            f"Too many failed attempts. Try again in {mins} minute{suffix}.",
        )

    if user is None or not user.password_hash:
        return _err(request, 401, "Invalid credentials")

    if not verify_password(body.password, str(user.password_hash)):
        next_count = int(user.failed_login_count or 0) + 1
        values: dict[str, Any] = {"failed_login_count": next_count}
        if next_count >= LOGIN_MAX_ATTEMPTS:
            values["locked_until"] = _now() + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)
        await db_session.execute(update(User).where(User.id == user.id).values(**values))
        await db_session.commit()
        return _err(request, 401, "Invalid credentials")

    await db_session.execute(
        update(User).where(User.id == user.id).values(last_login=_now(), failed_login_count=0, locked_until=None)
    )
    await db_session.flush()
    await db_session.refresh(user)

    if bool(user.mfa_enabled):
        if is_mfa_locked(user.mfa_locked_until):  # type: ignore[arg-type]
            mins = _minutes_until(user.mfa_locked_until)  # type: ignore[arg-type]
            suffix = "" if mins == 1 else "s"
            return _err(
                request,
                429,
                f"MFA temporarily locked. Try again in {mins} minute{suffix}.",
            )
        challenge_token = sign_mfa_challenge(str(user.id))
        await db_session.commit()
        return {
            "mfa_required": True,
            "challenge_token": challenge_token,
            "email": user.email,
        }

    session = await issue_auth_session(
        db_session,
        user,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
    )
    await db_session.commit()
    return session


@router.post("/mfa/verify-challenge")
async def mfa_verify_challenge(
    request: Request,
    body: MfaChallengeRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    try:
        decoded = verify_mfa_challenge(body.challenge_token)
    except jwt.PyJWTError:
        return _err(request, 401, "Challenge token invalid or expired")

    if decoded.get("stage") != "mfa_pending" or not decoded.get("sub"):
        return _err(request, 401, "Challenge token invalid")

    user = await _get_user_by_id(db_session, str(decoded["sub"]))
    if user is None or not bool(user.mfa_enabled) or not user.mfa_secret_enc:
        return _err(request, 401, "MFA not configured")
    if is_mfa_locked(user.mfa_locked_until):  # type: ignore[arg-type]
        mins = _minutes_until(user.mfa_locked_until)  # type: ignore[arg-type]
        suffix = "" if mins == 1 else "s"
        return _err(
            request,
            429,
            f"MFA temporarily locked. Try again in {mins} minute{suffix}.",
        )

    consumed_recovery_index = -1
    if body.use_recovery:
        hashes = decrypt_recovery_codes(user.mfa_recovery_codes_enc)  # type: ignore[arg-type]
        consumed_recovery_index = match_recovery_code(body.code, hashes)
        success = consumed_recovery_index >= 0
    else:
        success = verify_totp(body.code, decrypt_secret(str(user.mfa_secret_enc)))

    if not success:
        await _record_mfa_failure(db_session, user)
        await db_session.commit()
        return _err(request, 401, "Invalid MFA code")

    if consumed_recovery_index >= 0:
        hashes = decrypt_recovery_codes(user.mfa_recovery_codes_enc)  # type: ignore[arg-type]
        hashes.pop(consumed_recovery_index)
        await db_session.execute(
            update(User)
            .where(User.id == user.id)
            .values(
                mfa_recovery_codes_enc=encrypt_recovery_codes(hashes),
                mfa_failed_count=0,
                mfa_locked_until=None,
            )
        )
        await db_session.flush()
    else:
        await _reset_mfa_counters(db_session, str(user.id))

    await db_session.refresh(user)
    session = await issue_auth_session(
        db_session,
        user,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
    )
    await db_session.commit()
    return session


@router.post("/mfa/enroll")
async def mfa_enroll(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    user_id = _auth_user_id(request)
    if not user_id:
        return _err(request, 401, "Unauthorized")
    user = await _get_user_by_id(db_session, user_id)
    if user is None:
        return _err(request, 404, "User not found")
    if bool(user.mfa_enabled):
        return _err(
            request,
            409,
            "MFA is already enabled. Disable it first to re-enroll.",
        )
    secret = generate_secret()
    await db_session.execute(
        update(User).where(User.id == user_id).values(mfa_secret_enc=encrypt_secret(secret), mfa_verified_at=None)
    )
    await db_session.commit()
    return {
        "secret": secret,
        "otpauth_url": build_otpauth_url(str(user.email), secret),
    }


@router.post("/mfa/enroll/verify")
async def mfa_enroll_verify(
    request: Request,
    body: MfaEnrollVerifyRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    user_id = _auth_user_id(request)
    if not user_id:
        return _err(request, 401, "Unauthorized")
    user = await _get_user_by_id(db_session, user_id)
    if user is None or not user.mfa_secret_enc:
        return _err(
            request,
            400,
            "No pending MFA enrollment. Start enrollment first.",
        )
    if bool(user.mfa_enabled):
        return _err(request, 409, "MFA is already enabled.")

    if not verify_totp(body.code, decrypt_secret(str(user.mfa_secret_enc))):
        return _err(request, 400, "Invalid code. Scan the QR and try again.")

    plaintext_codes = generate_recovery_codes()
    hashed = hash_recovery_codes(plaintext_codes)
    await db_session.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            mfa_enabled=True,
            mfa_verified_at=_now(),
            mfa_recovery_codes_enc=encrypt_recovery_codes(hashed),
            mfa_failed_count=0,
            mfa_locked_until=None,
        )
    )
    await db_session.commit()
    return {"recovery_codes": plaintext_codes}


@router.post("/mfa/disable")
async def mfa_disable(
    request: Request,
    body: MfaDisableRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    user_id = _auth_user_id(request)
    if not user_id:
        return _err(request, 401, "Unauthorized")
    user = await _get_user_by_id(db_session, user_id)
    if user is None or not user.password_hash:
        return _err(request, 404, "User not found")
    if not bool(user.mfa_enabled) or not user.mfa_secret_enc:
        return _err(request, 400, "MFA is not enabled.")

    if not verify_password(body.password, str(user.password_hash)):
        return _err(request, 400, "Invalid password")

    if body.use_recovery:
        hashes = decrypt_recovery_codes(user.mfa_recovery_codes_enc)  # type: ignore[arg-type]
        mfa_ok = match_recovery_code(body.code, hashes) >= 0
    else:
        mfa_ok = verify_totp(body.code, decrypt_secret(str(user.mfa_secret_enc)))
    if not mfa_ok:
        await _record_mfa_failure(db_session, user)
        await db_session.commit()
        return _err(request, 400, "Invalid MFA code")

    await db_session.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            mfa_enabled=False,
            mfa_secret_enc=None,
            mfa_recovery_codes_enc=None,
            mfa_verified_at=None,
            mfa_failed_count=0,
            mfa_locked_until=None,
        )
    )
    await db_session.commit()
    return {"ok": True}


@router.post("/mfa/recovery-codes/regenerate")
async def mfa_recovery_codes_regenerate(
    request: Request,
    body: MfaRegenerateRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    user_id = _auth_user_id(request)
    if not user_id:
        return _err(request, 401, "Unauthorized")
    user = await _get_user_by_id(db_session, user_id)
    if user is None or not bool(user.mfa_enabled) or not user.mfa_secret_enc:
        return _err(request, 400, "MFA is not enabled.")
    if is_mfa_locked(user.mfa_locked_until):  # type: ignore[arg-type]
        return _err(request, 429, "MFA temporarily locked.")

    if not verify_totp(body.code, decrypt_secret(str(user.mfa_secret_enc))):
        await _record_mfa_failure(db_session, user)
        await db_session.commit()
        return _err(request, 400, "Invalid MFA code")

    plaintext_codes = generate_recovery_codes()
    hashed = hash_recovery_codes(plaintext_codes)
    await db_session.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            mfa_recovery_codes_enc=encrypt_recovery_codes(hashed),
            mfa_failed_count=0,
            mfa_locked_until=None,
        )
    )
    await db_session.commit()
    return {"recovery_codes": plaintext_codes}


@router.post("/refresh")
async def refresh_session(
    request: Request,
    body: RefreshRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    try:
        secret = os.getenv("JWT_SECRET")
        if not secret:
            return _err(request, 401, "Unauthorized")
        algo = os.getenv("JWT_ALGORITHMS", "HS256").split(",")[0].strip() or "HS256"
        decoded = jwt.decode(body.refresh_token, secret, algorithms=[algo])
    except jwt.PyJWTError:
        return _err(request, 401, "Unauthorized")

    if decoded.get("token_type") != "refresh":
        return _err(request, 401, "Unauthorized")
    if not all(decoded.get(k) for k in ("sid", "sub", "email", "role", "jti")):
        return _err(request, 401, "Unauthorized")

    presented_hash = hash_refresh_token(body.refresh_token)
    token_row = (
        await db_session.execute(select(RefreshToken).where(RefreshToken.token_hash == presented_hash))
    ).scalar_one_or_none()

    if (
        token_row is None
        or str(token_row.session_id) != str(decoded["sid"])
        or str(token_row.user_id) != str(decoded["sub"])
    ):
        return _err(request, 401, "Unauthorized")

    if token_row.rotated_to is not None or token_row.revoked_at is not None:
        now = _now()
        await db_session.execute(
            update(RefreshToken)
            .where(
                and_(
                    RefreshToken.session_id == token_row.session_id,
                    RefreshToken.revoked_at.is_(None),
                )
            )
            .values(revoked_at=now)
        )
        await db_session.execute(
            update(RefreshToken).where(RefreshToken.id == token_row.id).values(replay_detected_at=now)
        )
        await db_session.commit()
        logger.warning(
            f"refresh_token_replay_detected | session_id={token_row.session_id} "
            f"| user_id={token_row.user_id} | token_id={token_row.id}"
        )
        return _err(request, 401, "token_replay_detected")

    if token_row.expires_at.astimezone(UTC) < _now():
        return _err(request, 401, "Unauthorized")

    user = await _get_user_by_id(db_session, str(decoded["sub"]))
    if user is None:
        return _err(request, 401, "Unauthorized")

    payload = {
        "sub": str(decoded["sub"]),
        "sid": str(decoded["sid"]),
        "role": user.role,
        "email": user.email,
        "name": user.name,
        "permissions": permissions_for_role(str(user.role)),
    }
    tokens = sign_tokens(payload)
    new_expires_at = _now() + timedelta(seconds=REFRESH_TTL_SECONDS)
    new_token = RefreshToken(
        user_id=token_row.user_id,
        session_id=token_row.session_id,
        token_hash=hash_refresh_token(tokens["refresh_token"]),
        expires_at=new_expires_at,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
    )
    db_session.add(new_token)
    await db_session.flush()

    await db_session.execute(
        update(RefreshToken).where(RefreshToken.id == token_row.id).values(rotated_to=new_token.id, revoked_at=_now())
    )
    await db_session.commit()
    return {
        "token": tokens["token"],
        "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
    }


@router.post("/logout")
async def logout(
    request: Request,
    body: LogoutRequest | None = None,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    user_id = _auth_user_id(request)
    if not user_id:
        return _err(request, 401, "Unauthorized")
    body_session_id = body.session_id if body else None
    session_id = body_session_id or _auth_session_id(request)
    if not session_id:
        return _err(request, 400, "session_id is required")

    await db_session.execute(
        update(RefreshToken)
        .where(
            and_(
                RefreshToken.session_id == session_id,
                RefreshToken.user_id == user_id,
                RefreshToken.revoked_at.is_(None),
            )
        )
        .values(revoked_at=_now())
    )
    await db_session.commit()
    return {"status": "ok"}


@router.post("/change-password")
async def change_password(
    request: Request,
    body: ChangePasswordRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    user_id = _auth_user_id(request)
    if not user_id:
        return _err(request, 401, "Unauthorized")
    user = await _get_user_by_id(db_session, user_id)
    if user is None or not user.password_hash:
        return _err(request, 404, "User not found")
    if not verify_password(body.current_password, str(user.password_hash)):
        return _err(request, 400, "Invalid password")

    new_hash = hash_password(body.new_password)
    await db_session.execute(update(User).where(User.id == user_id).values(password_hash=new_hash))

    current_session_id = _auth_session_id(request)
    revoke_condition = and_(
        RefreshToken.user_id == user_id,
        RefreshToken.revoked_at.is_(None),
    )
    if current_session_id:
        revoke_condition = and_(
            revoke_condition,
            RefreshToken.session_id != current_session_id,
        )
    await db_session.execute(update(RefreshToken).where(revoke_condition).values(revoked_at=_now()))
    await db_session.commit()
    return {"status": "ok"}


@router.get("/sessions")
async def list_sessions(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    user_id = _auth_user_id(request)
    if not user_id:
        return _err(request, 401, "Unauthorized")
    rows = (
        (
            await db_session.execute(
                select(RefreshToken)
                .where(
                    and_(
                        RefreshToken.user_id == user_id,
                        RefreshToken.revoked_at.is_(None),
                    )
                )
                .order_by(RefreshToken.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    seen: set[str] = set()
    current_sid = _auth_session_id(request)
    data: list[dict[str, Any]] = []
    for row in rows:
        sid = str(row.session_id)
        if sid in seen:
            continue
        seen.add(sid)
        data.append(
            {
                "id": sid,
                "ip_address": row.ip_address,
                "user_agent": row.user_agent,
                "expires_at": row.expires_at.isoformat() if row.expires_at else None,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "current": current_sid == sid,
            }
        )
    return {"data": data}


@router.post("/forgot-password")
async def forgot_password(
    request: Request,
    body: ForgotPasswordRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    message = "If the account exists, a password reset link has been generated."
    user = (
        await db_session.execute(select(User).where(and_(User.email == body.email.lower(), User.deleted_at.is_(None))))
    ).scalar_one_or_none()

    if user is None:
        return {"message": message}

    raw_token = f"{uuid.uuid4()}{uuid.uuid4()}"
    db_session.add(
        VerificationToken(
            user_id=user.id,
            token_hash=hash_token(raw_token),
            kind="password_reset",
            expires_at=_now() + timedelta(seconds=RESET_TOKEN_TTL_SECONDS),
        )
    )
    await db_session.flush()

    reset_link = build_reset_link(raw_token)
    try:
        sent = await send_password_reset_email(str(user.email), reset_link)
        if not sent:
            logger.warning("SMTP is not configured; reset email was not sent.")
    except Exception as exc:
        logger.error(f"Failed to send password reset email via SMTP err={exc}")

    await db_session.commit()
    response: dict[str, Any] = {"message": message}
    if os.getenv("APP_ENV", "").lower() != "production":
        response["reset_token"] = raw_token
    return response


@router.post("/reset-password")
async def reset_password(
    request: Request,
    body: ResetPasswordRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    token_hash = hash_token(body.token)
    record = (
        await db_session.execute(
            select(VerificationToken).where(
                and_(
                    VerificationToken.token_hash == token_hash,
                    VerificationToken.kind == "password_reset",
                    VerificationToken.consumed_at.is_(None),
                    VerificationToken.expires_at > _now(),
                )
            )
        )
    ).scalar_one_or_none()
    if record is None:
        return _err(request, 400, "Invalid or expired reset token")

    new_hash = hash_password(body.new_password)
    await db_session.execute(update(User).where(User.id == record.user_id).values(password_hash=new_hash))
    await db_session.execute(
        update(VerificationToken).where(VerificationToken.id == record.id).values(consumed_at=_now())
    )
    await db_session.execute(
        update(RefreshToken)
        .where(
            and_(
                RefreshToken.user_id == record.user_id,
                RefreshToken.revoked_at.is_(None),
            )
        )
        .values(revoked_at=_now())
    )
    await db_session.commit()
    return {"status": "ok"}


@router.post("/verify-email")
async def verify_email(
    request: Request,
    body: VerifyEmailRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    token_hash = hash_token(body.token)
    record = (
        await db_session.execute(
            select(VerificationToken).where(
                and_(
                    VerificationToken.token_hash == token_hash,
                    VerificationToken.kind == "email_verify",
                    VerificationToken.consumed_at.is_(None),
                    VerificationToken.expires_at > _now(),
                )
            )
        )
    ).scalar_one_or_none()
    if record is None:
        return _err(request, 400, "Invalid or expired verification token")

    await db_session.execute(
        update(User).where(User.id == record.user_id).values(email_verified=True, email_verified_at=_now())
    )
    await db_session.execute(
        update(VerificationToken).where(VerificationToken.id == record.id).values(consumed_at=_now())
    )
    await db_session.commit()
    return {"verified": True}


@router.post("/resend-verification")
async def resend_verification(
    request: Request,
    body: ResendVerificationRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    user = (
        await db_session.execute(select(User).where(and_(User.email == body.email.lower(), User.deleted_at.is_(None))))
    ).scalar_one_or_none()

    if user is not None and not bool(user.email_verified):
        raw_token = f"{uuid.uuid4()}{uuid.uuid4()}"
        db_session.add(
            VerificationToken(
                user_id=user.id,
                token_hash=hash_token(raw_token),
                kind="email_verify",
                expires_at=_now() + timedelta(seconds=VERIFICATION_TOKEN_TTL_SECONDS),
            )
        )
        await db_session.flush()
        link = build_verification_link(raw_token)
        try:
            sent = await send_verification_email(str(user.email), link)
            if not sent:
                logger.warning("SMTP is not configured; verification email was not sent.")
        except Exception as exc:
            logger.error(f"Failed to send verification email via SMTP err={exc}")

    await db_session.commit()
    return JSONResponse(status_code=202, content={"sent": True})


@router.get("/me")
async def me(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
) -> Any:
    user_id = _auth_user_id(request)
    if not user_id:
        return _err(request, 401, "Unauthorized")
    user = await _get_user_by_id(db_session, user_id)
    if user is None or user.deleted_at is not None:
        return _err(request, 404, "User not found")
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "email_verified": bool(user.email_verified),
        "mfa_enabled": bool(user.mfa_enabled),
        "last_login": user.last_login.isoformat() if user.last_login else None,
        "created_at": user.created_at.isoformat(),
        "updated_at": user.updated_at.isoformat(),
    }
