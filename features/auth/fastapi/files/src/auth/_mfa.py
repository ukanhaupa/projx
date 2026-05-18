import os
import secrets
from datetime import UTC, datetime

import pyotp

from src.utils import decrypt_config, encrypt_config

from ._password import hash_password, verify_password

_ISSUER = os.getenv("MFA_ISSUER", "projx")
_RECOVERY_CODE_COUNT = 10
_RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_TOTP_WINDOW = 3

MFA_MAX_ATTEMPTS = 5
MFA_LOCKOUT_MINUTES = 15


def generate_secret() -> str:
    return pyotp.random_base32(length=32)


def build_otpauth_url(email: str, secret: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=_ISSUER)


def verify_totp(code: str, secret: str) -> bool:
    cleaned = code.strip()
    if not cleaned:
        return False
    return pyotp.TOTP(secret).verify(cleaned, valid_window=_TOTP_WINDOW)


def _pick_chars(length: int) -> str:
    return "".join(secrets.choice(_RECOVERY_CODE_ALPHABET) for _ in range(length))


def generate_recovery_codes(count: int = _RECOVERY_CODE_COUNT) -> list[str]:
    return [f"{_pick_chars(4)}-{_pick_chars(4)}" for _ in range(count)]


def _denormalize(code: str) -> str:
    stripped = code.strip().upper().replace(" ", "").replace("-", "")
    return f"{stripped[:4]}-{stripped[4:]}"


def hash_recovery_codes(codes: list[str]) -> list[str]:
    return [hash_password(_denormalize(code)) for code in codes]


def match_recovery_code(input_code: str, hashes: list[str]) -> int:
    normalized = _denormalize(input_code)
    for i, h in enumerate(hashes):
        if verify_password(normalized, h):
            return i
    return -1


def encrypt_recovery_codes(hashes: list[str]) -> str:
    return encrypt_config({"hashes": hashes})


def decrypt_recovery_codes(enc: str | None) -> list[str]:
    if not enc:
        return []
    try:
        data = decrypt_config(enc)
    except Exception:
        return []
    raw = data.get("hashes")
    if not isinstance(raw, list):
        return []
    return [str(h) for h in raw]


def encrypt_secret(secret: str) -> str:
    return encrypt_config({"secret": secret})


def decrypt_secret(enc: str) -> str:
    data = decrypt_config(enc)
    secret = data.get("secret")
    if not isinstance(secret, str):
        raise ValueError("MFA secret payload is malformed")
    return secret


def is_mfa_locked(locked_until: datetime | None) -> bool:
    if locked_until is None:
        return False
    dt = locked_until
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt > datetime.now(UTC)
