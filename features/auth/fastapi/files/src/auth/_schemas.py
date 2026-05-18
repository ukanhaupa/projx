from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class _BaseSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")


class SignupRequest(_BaseSchema):
    email: EmailStr
    name: str = Field(min_length=1)
    password: str = Field(min_length=8)


class LoginRequest(_BaseSchema):
    email: EmailStr
    password: str


class MfaChallengeRequest(_BaseSchema):
    challenge_token: str
    code: str = Field(min_length=6, max_length=32)
    use_recovery: bool = False


class MfaEnrollVerifyRequest(_BaseSchema):
    code: str = Field(min_length=6, max_length=10)


class MfaDisableRequest(_BaseSchema):
    password: str
    code: str = Field(min_length=6, max_length=32)
    use_recovery: bool = False


class MfaRegenerateRequest(_BaseSchema):
    code: str = Field(min_length=6, max_length=10)


class RefreshRequest(_BaseSchema):
    refresh_token: str


class LogoutRequest(_BaseSchema):
    session_id: str | None = None


class ChangePasswordRequest(_BaseSchema):
    current_password: str
    new_password: str = Field(min_length=8)


class ForgotPasswordRequest(_BaseSchema):
    email: EmailStr


class ResetPasswordRequest(_BaseSchema):
    token: str
    new_password: str = Field(min_length=8)


class VerifyEmailRequest(_BaseSchema):
    token: str = Field(min_length=1)


class ResendVerificationRequest(_BaseSchema):
    email: EmailStr


class UserPublic(_BaseSchema):
    id: str
    email: str
    name: str
    role: str
    last_login: datetime | None
    created_at: datetime
    updated_at: datetime


class TokensResponse(_BaseSchema):
    user: UserPublic
    token: str
    access_token: str
    refresh_token: str


class MfaRequiredResponse(_BaseSchema):
    mfa_required: bool = True
    challenge_token: str
    email: str


class RefreshResponse(_BaseSchema):
    token: str
    access_token: str
    refresh_token: str


class MfaEnrollResponse(_BaseSchema):
    secret: str
    otpauth_url: str


class RecoveryCodesResponse(_BaseSchema):
    recovery_codes: list[str]


class StatusResponse(_BaseSchema):
    status: str = "ok"


class OkResponse(_BaseSchema):
    ok: bool = True


class ForgotPasswordResponse(_BaseSchema):
    message: str
    reset_token: str | None = None


class VerifyEmailResponse(_BaseSchema):
    verified: bool = True


class ResendVerificationResponse(_BaseSchema):
    sent: bool = True


class SessionItem(_BaseSchema):
    id: str
    ip_address: str | None
    user_agent: str | None
    expires_at: datetime
    created_at: datetime
    current: bool


class SessionsResponse(_BaseSchema):
    data: list[SessionItem]


class MeResponse(_BaseSchema):
    id: str
    email: str
    name: str
    role: str
    email_verified: bool
    mfa_enabled: bool
    last_login: datetime | None
    created_at: datetime
    updated_at: datetime


class ErrorResponse(_BaseSchema):
    detail: str
    request_id: str | None = None
    extra: dict[str, Any] | None = None
