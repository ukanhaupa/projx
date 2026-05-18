import uuid
from typing import Any

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID

from src.entities.base import BaseModel_


def _uuid_default() -> str:
    return str(uuid.uuid4())


class User(BaseModel_):
    __tablename__ = "users"
    __private__ = True
    __audit_ignore__ = True

    id: Any = Column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        default=_uuid_default,
        nullable=False,
    )
    email = Column(String(255), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=True)
    role = Column(String(32), nullable=False, default="user", server_default="user")
    email_verified = Column(Boolean, nullable=False, default=False, server_default="false")
    email_verified_at = Column(DateTime(timezone=True), nullable=True)
    failed_login_count = Column(Integer, nullable=False, default=0, server_default="0")
    locked_until = Column(DateTime(timezone=True), nullable=True)
    mfa_enabled = Column(Boolean, nullable=False, default=False, server_default="false")
    mfa_secret_enc = Column(Text, nullable=True)
    mfa_recovery_codes_enc = Column(Text, nullable=True)
    mfa_verified_at = Column(DateTime(timezone=True), nullable=True)
    mfa_failed_count = Column(Integer, nullable=False, default=0, server_default="0")
    mfa_locked_until = Column(DateTime(timezone=True), nullable=True)
    last_login = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class RefreshToken(BaseModel_):
    __tablename__ = "refresh_tokens"
    __private__ = True
    __audit_ignore__ = True

    id: Any = Column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        default=_uuid_default,
        nullable=False,
    )
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    session_id = Column(UUID(as_uuid=False), nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(Text, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    rotated_to = Column(UUID(as_uuid=False), nullable=True)
    replay_detected_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (  # type: ignore[assignment]
        Index("ix_refresh_tokens_user_id", "user_id"),
        Index("ix_refresh_tokens_session_id", "session_id"),
        {"extend_existing": True},
    )


class VerificationToken(BaseModel_):
    __tablename__ = "verification_tokens"
    __private__ = True
    __audit_ignore__ = True

    id: Any = Column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        default=_uuid_default,
        nullable=False,
    )
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String(32), nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    consumed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (  # type: ignore[assignment]
        Index("ix_verification_tokens_user_id_kind", "user_id", "kind"),
        {"extend_existing": True},
    )
