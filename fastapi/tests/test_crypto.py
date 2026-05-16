import base64

import pytest
from cryptography.exceptions import InvalidTag

from src.utils._crypto import decrypt_config, encrypt_config


def test_round_trip_simple():
    data = {"host": "mail.example", "port": 587}
    ct = encrypt_config(data)
    assert ct != ""
    assert decrypt_config(ct) == data


def test_random_iv_produces_different_ciphertext():
    data = {"k": "v"}
    a = encrypt_config(data)
    b = encrypt_config(data)
    assert a != b
    assert decrypt_config(a) == data
    assert decrypt_config(b) == data


def test_tampered_ciphertext_rejected():
    ct = encrypt_config({"secret": "x"})
    raw = bytearray(base64.b64decode(ct))
    raw[-1] ^= 1
    tampered = base64.b64encode(bytes(raw)).decode()
    with pytest.raises(InvalidTag):
        decrypt_config(tampered)


def test_short_ciphertext_rejected():
    short = base64.b64encode(b"\x00" * 10).decode()
    with pytest.raises(RuntimeError, match="too short"):
        decrypt_config(short)


def test_no_silent_jwt_secret_fallback(monkeypatch):
    monkeypatch.delenv("CRED_ENCRYPTION_KEY", raising=False)
    monkeypatch.setenv("JWT_SECRET", "any-jwt-secret-value")
    with pytest.raises(RuntimeError, match="CRED_ENCRYPTION_KEY"):
        encrypt_config({"k": "v"})


def test_invalid_key_length_rejected(monkeypatch):
    monkeypatch.setenv("CRED_ENCRYPTION_KEY", base64.b64encode(b"too-short").decode())
    with pytest.raises(RuntimeError, match="32 bytes"):
        encrypt_config({"k": "v"})
