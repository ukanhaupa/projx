import os
import uuid
from datetime import UTC, datetime, timedelta

import asyncio

import jwt
import pyotp
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from src.app import app
from src.configs import get_db_session

from src.auth import _mailer
from src.auth._mfa import (
    encrypt_recovery_codes,
    encrypt_secret,
    generate_secret,
    hash_recovery_codes,
)
from src.auth._models import RefreshToken, User, VerificationToken
from src.auth._password import hash_password, hash_token
from src.auth._verification_jobs import cleanup_auth_artifacts

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def _clear_auth_tables(test_db: AsyncSession):
    await test_db.execute(delete(RefreshToken))
    await test_db.execute(delete(VerificationToken))
    await test_db.execute(delete(User))
    await test_db.commit()
    _mailer._reset_mailer_for_tests()
    yield
    _mailer._reset_mailer_for_tests()


def _jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


async def _seed_user(
    test_db: AsyncSession,
    *,
    email: str = "user@example.com",
    name: str = "User",
    password: str = "correct-horse",
    role: str = "user",
    email_verified: bool = False,
    mfa_enabled: bool = False,
    mfa_secret: str | None = None,
    mfa_recovery_hashes: list[str] | None = None,
) -> User:
    user = User(
        email=email.lower(),
        name=name,
        password_hash=hash_password(password),
        role=role,
        email_verified=email_verified,
        mfa_enabled=mfa_enabled,
        mfa_secret_enc=encrypt_secret(mfa_secret) if mfa_secret else None,
        mfa_recovery_codes_enc=encrypt_recovery_codes(mfa_recovery_hashes) if mfa_recovery_hashes else None,
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)
    return user


def _auth_headers(user: User, session_id: str | None = None) -> dict[str, str]:
    sid = session_id or str(uuid.uuid4())
    exp = datetime.now(UTC) + timedelta(hours=1)
    payload = {
        "sub": str(user.id),
        "sid": sid,
        "role": user.role,
        "email": user.email,
        "name": user.name,
        "permissions": ["*:*.*"] if user.role == "admin" else ["*:read.*"],
        "exp": int(exp.timestamp()),
        "iat": int(datetime.now(UTC).timestamp()),
        "token_type": "access",
        "jti": str(uuid.uuid4()),
    }
    token = jwt.encode(payload, _jwt_secret(), algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


class TestSignup:
    async def test_signup_creates_user_and_returns_tokens(self, client: AsyncClient, test_db: AsyncSession):
        response = await client.post(
            "/api/v1/auth/signup",
            json={
                "email": "alice@example.com",
                "name": "Alice",
                "password": "supersecret-1",
            },
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["user"]["email"] == "alice@example.com"
        assert body["user"]["role"] == "admin"
        assert body["token"]
        assert body["refresh_token"]

        result = await test_db.execute(select(User).where(User.email == "alice@example.com"))
        user = result.scalar_one()
        assert user.password_hash and user.password_hash != "supersecret-1"

    async def test_duplicate_email_returns_409(self, client: AsyncClient, test_db: AsyncSession):
        await _seed_user(test_db, email="bob@example.com")
        response = await client.post(
            "/api/v1/auth/signup",
            json={
                "email": "bob@example.com",
                "name": "Bob",
                "password": "anotherpass-1",
            },
        )
        assert response.status_code == 409

    async def test_second_user_is_not_admin(self, client: AsyncClient, test_db: AsyncSession):
        await _seed_user(test_db, email="first@example.com", role="admin")
        response = await client.post(
            "/api/v1/auth/signup",
            json={
                "email": "second@example.com",
                "name": "Second",
                "password": "supersecret-2",
            },
        )
        assert response.status_code == 201
        assert response.json()["user"]["role"] == "user"


class TestLogin:
    async def test_login_with_valid_credentials_returns_tokens(self, client: AsyncClient, test_db: AsyncSession):
        await _seed_user(test_db, email="charlie@example.com", password="strongpass-1")  # pragma: allowlist secret
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "charlie@example.com", "password": "strongpass-1"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["token"]

    async def test_login_with_wrong_password_returns_401(self, client: AsyncClient, test_db: AsyncSession):
        await _seed_user(test_db, email="dave@example.com", password="rightpass-1")  # pragma: allowlist secret
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "dave@example.com", "password": "wrongpass-1"},
        )
        assert response.status_code == 401

    async def test_login_lockout_after_five_failures(self, client: AsyncClient, test_db: AsyncSession):
        await _seed_user(test_db, email="eve@example.com", password="goodpass-1")  # pragma: allowlist secret
        for _ in range(5):
            await client.post(
                "/api/v1/auth/login",
                json={"email": "eve@example.com", "password": "bad-pass-1"},
            )
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "eve@example.com", "password": "goodpass-1"},
        )
        assert response.status_code == 429

    async def test_login_with_mfa_returns_challenge(self, client: AsyncClient, test_db: AsyncSession):
        secret = generate_secret()
        await _seed_user(
            test_db,
            email="mfa@example.com",
            password="goodpass-1",  # pragma: allowlist secret
            mfa_enabled=True,
            mfa_secret=secret,
            mfa_recovery_hashes=hash_recovery_codes(["ABCD-EFGH"]),
        )
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "mfa@example.com", "password": "goodpass-1"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["mfa_required"] is True
        assert body["challenge_token"]


class TestMfaChallenge:
    async def test_verify_challenge_with_totp(self, client: AsyncClient, test_db: AsyncSession):
        secret = generate_secret()
        user = await _seed_user(
            test_db,
            email="totp@example.com",
            password="goodpass-1",  # pragma: allowlist secret
            mfa_enabled=True,
            mfa_secret=secret,
        )
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "totp@example.com", "password": "goodpass-1"},
        )
        challenge_token = login.json()["challenge_token"]
        code = pyotp.TOTP(secret).now()
        response = await client.post(
            "/api/v1/auth/mfa/verify-challenge",
            json={"challenge_token": challenge_token, "code": code},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["token"]
        assert body["user"]["email"] == user.email

    async def test_verify_challenge_with_recovery_code(self, client: AsyncClient, test_db: AsyncSession):
        secret = generate_secret()
        recovery_codes = ["ABCD-EFGH"]
        await _seed_user(
            test_db,
            email="recovery@example.com",
            password="goodpass-1",  # pragma: allowlist secret
            mfa_enabled=True,
            mfa_secret=secret,
            mfa_recovery_hashes=hash_recovery_codes(recovery_codes),
        )
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "recovery@example.com", "password": "goodpass-1"},
        )
        challenge_token = login.json()["challenge_token"]
        response = await client.post(
            "/api/v1/auth/mfa/verify-challenge",
            json={
                "challenge_token": challenge_token,
                "code": "ABCD-EFGH",
                "use_recovery": True,
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["token"]

    async def test_invalid_code_returns_401(self, client: AsyncClient, test_db: AsyncSession):
        secret = generate_secret()
        await _seed_user(
            test_db,
            email="bad@example.com",
            password="goodpass-1",  # pragma: allowlist secret
            mfa_enabled=True,
            mfa_secret=secret,
        )
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "bad@example.com", "password": "goodpass-1"},
        )
        challenge_token = login.json()["challenge_token"]
        response = await client.post(
            "/api/v1/auth/mfa/verify-challenge",
            json={"challenge_token": challenge_token, "code": "000000"},
        )
        assert response.status_code == 401


class TestMfaEnrollAndDisable:
    async def test_enroll_then_verify_returns_recovery_codes(self, client: AsyncClient, test_db: AsyncSession):
        user = await _seed_user(test_db, email="enroll@example.com")
        headers = _auth_headers(user)

        enroll = await client.post("/api/v1/auth/mfa/enroll", headers=headers)
        assert enroll.status_code == 200
        secret = enroll.json()["secret"]

        verify = await client.post(
            "/api/v1/auth/mfa/enroll/verify",
            headers=headers,
            json={"code": pyotp.TOTP(secret).now()},
        )
        assert verify.status_code == 200
        assert len(verify.json()["recovery_codes"]) == 10

    async def test_disable_requires_password_and_code(self, client: AsyncClient, test_db: AsyncSession):
        secret = generate_secret()
        user = await _seed_user(
            test_db,
            email="disable@example.com",
            password="goodpass-1",  # pragma: allowlist secret
            mfa_enabled=True,
            mfa_secret=secret,
        )
        headers = _auth_headers(user)
        response = await client.post(
            "/api/v1/auth/mfa/disable",
            headers=headers,
            json={
                "password": "goodpass-1",
                "code": pyotp.TOTP(secret).now(),
            },
        )
        assert response.status_code == 200
        assert response.json() == {"ok": True}

        await test_db.refresh(user)
        result = await test_db.execute(select(User).where(User.id == user.id))
        refreshed = result.scalar_one()
        assert bool(refreshed.mfa_enabled) is False


class TestRefreshAndLogout:
    async def test_refresh_rotates_token(self, client: AsyncClient, test_db: AsyncSession):
        await _seed_user(test_db, email="rot@example.com", password="goodpass-1")  # pragma: allowlist secret
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "rot@example.com", "password": "goodpass-1"},
        )
        refresh_token = login.json()["refresh_token"]

        response = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": refresh_token},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["refresh_token"] != refresh_token

    async def test_refresh_replay_detection_revokes_session(self, client: AsyncClient, test_db: AsyncSession):
        await _seed_user(test_db, email="replay@example.com", password="goodpass-1")  # pragma: allowlist secret
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "replay@example.com", "password": "goodpass-1"},
        )
        refresh_token = login.json()["refresh_token"]

        first = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
        assert first.status_code == 200

        replay = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
        assert replay.status_code == 401
        assert replay.json()["detail"] == "token_replay_detected"

    async def test_refresh_concurrent_rotation_single_winner(self, test_db: AsyncSession, test_engine: AsyncEngine):
        await _seed_user(test_db, email="race@example.com", password="goodpass-1")  # pragma: allowlist secret

        session_factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

        async def override_get_db_session():
            async with session_factory() as session:
                yield session

        app.dependency_overrides[get_db_session] = override_get_db_session
        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as race_client:
                login = await race_client.post(
                    "/api/v1/auth/login",
                    json={"email": "race@example.com", "password": "goodpass-1"},
                )
                refresh_token = login.json()["refresh_token"]

                attempts = await asyncio.gather(
                    *(race_client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token}) for _ in range(8))
                )

            winners = [r for r in attempts if r.status_code == 200]
            losers = [r for r in attempts if r.status_code == 401]
            assert len(winners) == 1
            assert len(losers) == len(attempts) - 1
            for loser in losers:
                assert loser.json()["detail"] == "token_replay_detected"
        finally:
            app.dependency_overrides.clear()

    async def test_logout_revokes_session(self, client: AsyncClient, test_db: AsyncSession):
        user = await _seed_user(test_db, email="lo@example.com")
        sid = str(uuid.uuid4())
        token_row = RefreshToken(
            user_id=user.id,
            session_id=sid,
            token_hash=hash_token(f"raw-{sid}"),
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
        test_db.add(token_row)
        await test_db.commit()

        headers = _auth_headers(user, session_id=sid)
        response = await client.post("/api/v1/auth/logout", headers=headers, json={})
        assert response.status_code == 200

        result = await test_db.execute(select(RefreshToken).where(RefreshToken.session_id == sid))
        revoked = result.scalar_one()
        assert revoked.revoked_at is not None


class TestChangePassword:
    async def test_change_password_succeeds_with_current(self, client: AsyncClient, test_db: AsyncSession):
        user = await _seed_user(test_db, email="cp@example.com", password="oldpass-1")  # pragma: allowlist secret
        headers = _auth_headers(user)
        response = await client.post(
            "/api/v1/auth/change-password",
            headers=headers,
            json={"current_password": "oldpass-1", "new_password": "newpass-1"},
        )
        assert response.status_code == 200

    async def test_change_password_rejects_wrong_current(self, client: AsyncClient, test_db: AsyncSession):
        user = await _seed_user(test_db, email="cp2@example.com", password="oldpass-1")  # pragma: allowlist secret
        headers = _auth_headers(user)
        response = await client.post(
            "/api/v1/auth/change-password",
            headers=headers,
            json={"current_password": "wrong-1", "new_password": "newpass-1"},
        )
        assert response.status_code == 400


class TestSessions:
    async def test_list_sessions_returns_active_only(self, client: AsyncClient, test_db: AsyncSession):
        user = await _seed_user(test_db, email="ses@example.com")
        current_sid = str(uuid.uuid4())
        other_sid = str(uuid.uuid4())
        for sid, revoked in (
            (current_sid, None),
            (other_sid, None),
            (str(uuid.uuid4()), datetime.now(UTC)),
        ):
            test_db.add(
                RefreshToken(
                    user_id=user.id,
                    session_id=sid,
                    token_hash=hash_token(f"raw-{sid}-{revoked}"),
                    expires_at=datetime.now(UTC) + timedelta(days=1),
                    revoked_at=revoked,
                )
            )
        await test_db.commit()

        headers = _auth_headers(user, session_id=current_sid)
        response = await client.get("/api/v1/auth/sessions", headers=headers)
        assert response.status_code == 200
        data = response.json()["data"]
        sids = {item["id"] for item in data}
        assert current_sid in sids
        assert other_sid in sids
        assert len(sids) == 2
        assert any(item["current"] is True for item in data)


class TestForgotPassword:
    async def test_forgot_password_generates_token_for_existing_user(self, client: AsyncClient, test_db: AsyncSession):
        await _seed_user(test_db, email="fp@example.com")
        response = await client.post(
            "/api/v1/auth/forgot-password",
            json={"email": "fp@example.com"},
        )
        assert response.status_code == 200
        body = response.json()
        assert "reset_token" in body
        assert body["reset_token"]

    async def test_forgot_password_silent_for_unknown_email(self, client: AsyncClient):
        response = await client.post(
            "/api/v1/auth/forgot-password",
            json={"email": "unknown@example.com"},
        )
        assert response.status_code == 200
        assert "reset_token" not in response.json()

    async def test_reset_password_consumes_token(self, client: AsyncClient, test_db: AsyncSession):
        await _seed_user(test_db, email="rp@example.com")
        fp = await client.post("/api/v1/auth/forgot-password", json={"email": "rp@example.com"})
        token = fp.json()["reset_token"]
        response = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": token, "new_password": "fresh-pass-1"},
        )
        assert response.status_code == 200

        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "rp@example.com", "password": "fresh-pass-1"},
        )
        assert login.status_code == 200


class TestEmailVerification:
    async def test_verify_email_marks_user_verified(self, client: AsyncClient, test_db: AsyncSession):
        user = await _seed_user(test_db, email="ve@example.com")
        raw_token = f"{uuid.uuid4()}{uuid.uuid4()}"
        test_db.add(
            VerificationToken(
                user_id=user.id,
                kind="email_verify",
                token_hash=hash_token(raw_token),
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        await test_db.commit()

        response = await client.post("/api/v1/auth/verify-email", json={"token": raw_token})
        assert response.status_code == 200
        assert response.json()["verified"] is True

        result = await test_db.execute(select(User).where(User.id == user.id))
        refreshed = result.scalar_one()
        assert bool(refreshed.email_verified) is True

    async def test_resend_verification_returns_202(self, client: AsyncClient, test_db: AsyncSession):
        await _seed_user(test_db, email="resend@example.com", email_verified=False)
        response = await client.post(
            "/api/v1/auth/resend-verification",
            json={"email": "resend@example.com"},
        )
        assert response.status_code == 202


class TestMe:
    async def test_me_returns_user(self, client: AsyncClient, test_db: AsyncSession):
        user = await _seed_user(test_db, email="me@example.com")
        headers = _auth_headers(user)
        response = await client.get("/api/v1/auth/me", headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["email"] == "me@example.com"

    async def test_me_requires_auth(self, client: AsyncClient):
        response = await client.get("/api/v1/auth/me")
        assert response.status_code == 401


class TestCleanup:
    async def test_cleanup_removes_expired_tokens(self, test_db: AsyncSession):
        user = await _seed_user(test_db, email="cl@example.com")
        long_ago = datetime.now(UTC) - timedelta(days=60)
        test_db.add(
            VerificationToken(
                user_id=user.id,
                kind="email_verify",
                token_hash=hash_token("expired-token"),
                expires_at=datetime.now(UTC) - timedelta(days=1),
            )
        )
        test_db.add(
            RefreshToken(
                user_id=user.id,
                session_id=str(uuid.uuid4()),
                token_hash=hash_token("expired-refresh"),
                expires_at=long_ago,
            )
        )
        await test_db.commit()

        result = await cleanup_auth_artifacts(test_db)
        await test_db.commit()
        assert result["expired_verification_tokens"] >= 1
        assert result["expired_refresh_tokens"] >= 1
