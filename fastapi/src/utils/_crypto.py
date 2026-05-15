import base64
import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

IV_LEN = 12
TAG_LEN = 16


def _get_key() -> bytes:
    raw = os.environ.get("CRED_ENCRYPTION_KEY")
    if not raw:
        raise RuntimeError(
            "CRED_ENCRYPTION_KEY is required. "
            'Generate one with: python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"'
        )
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise RuntimeError(f"CRED_ENCRYPTION_KEY must decode to 32 bytes (got {len(key)})")
    return key


def encrypt_config(data: dict[str, Any]) -> str:
    key = _get_key()
    iv = os.urandom(IV_LEN)
    aesgcm = AESGCM(key)
    plaintext = json.dumps(data).encode("utf-8")
    ct_with_tag = aesgcm.encrypt(iv, plaintext, None)
    ct = ct_with_tag[:-TAG_LEN]
    tag = ct_with_tag[-TAG_LEN:]
    return base64.b64encode(iv + tag + ct).decode("utf-8")


def decrypt_config(ciphertext: str) -> dict[str, Any]:
    key = _get_key()
    buf = base64.b64decode(ciphertext)
    if len(buf) < IV_LEN + TAG_LEN:
        raise RuntimeError("Ciphertext too short")
    iv = buf[:IV_LEN]
    tag = buf[IV_LEN : IV_LEN + TAG_LEN]
    ct = buf[IV_LEN + TAG_LEN :]
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, ct + tag, None)
    return json.loads(plaintext)
