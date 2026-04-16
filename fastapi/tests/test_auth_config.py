from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest

from src.configs._auth import (
    JWTVerificationConfig,
    JWTVerificationError,
    JWTVerifier,
    _infer_provider,
    _optional_env,
    _parse_algorithms,
    _parse_bool,
    _parse_csv,
    _parse_positive_int,
    _without_trailing_slash,
)


class TestParseHelpers:
    def test_parse_bool_true(self):
        assert _parse_bool("true", False) is True
        assert _parse_bool("1", False) is True
        assert _parse_bool("yes", False) is True
        assert _parse_bool("on", False) is True

    def test_parse_bool_false(self):
        assert _parse_bool("false", True) is False
        assert _parse_bool("no", True) is False

    def test_parse_bool_none(self):
        assert _parse_bool(None, True) is True
        assert _parse_bool(None, False) is False

    def test_parse_csv(self):
        assert _parse_csv("a,b,c", []) == ["a", "b", "c"]
        assert _parse_csv("  x , y ", []) == ["x", "y"]
        assert _parse_csv(None, ["default"]) == ["default"]
        assert _parse_csv("", ["default"]) == ["default"]

    def test_parse_positive_int(self):
        assert _parse_positive_int("42", 0) == 42
        assert _parse_positive_int(None, 10) == 10
        assert _parse_positive_int("abc", 5) == 5
        assert _parse_positive_int("-1", 5) == 5
        assert _parse_positive_int("0", 5) == 5

    def test_optional_env(self):
        assert _optional_env(None) is None
        assert _optional_env("") is None
        assert _optional_env("  ") is None
        assert _optional_env("value") == "value"

    def test_without_trailing_slash(self):
        assert _without_trailing_slash("http://host/") == "http://host"
        assert _without_trailing_slash("http://host") == "http://host"

    def test_parse_algorithms(self):
        assert _parse_algorithms("RS256,HS256", []) == ["RS256", "HS256"]
        assert _parse_algorithms("INVALID", ["RS256"]) == ["RS256"]
        assert _parse_algorithms(None, ["HS256"]) == ["HS256"]


class TestInferProvider:
    def test_explicit(self):
        assert _infer_provider("shared_secret", None, None) == "shared_secret"
        assert _infer_provider("public_key", None, None) == "public_key"
        assert _infer_provider("jwks", None, None) == "jwks"

    def test_auto_jwks(self):
        assert _infer_provider("auto", "https://jwks.url", None) == "jwks"

    def test_auto_public_key(self):
        assert _infer_provider("auto", None, "pubkey") == "public_key"

    def test_auto_default(self):
        assert _infer_provider("auto", None, None) == "shared_secret"
        assert _infer_provider(None, None, None) == "shared_secret"


class TestJWTVerifier:
    secret = "test-secret-that-is-at-least-32-bytes-long"

    def _make_verifier(self, **overrides):
        defaults: dict[str, Any] = dict(
            provider="shared_secret",
            algorithms=["HS256"],
            secret=self.secret,
            public_key=None,
            jwks_url=None,
            jwks_timeout_ms=3000,
            jwks_cache_ttl_sec=300,
            jwks_cache_max_keys=100,
            issuer=None,
            audience=None,
            require_exp=True,
            verify_nbf=True,
            verify_iat=False,
        )
        defaults.update(overrides)
        config = JWTVerificationConfig(**defaults)
        return JWTVerifier(config)

    def _make_token(self, **claims):
        defaults = {
            "sub": "1",
            "exp": int((datetime.now(UTC) + timedelta(hours=1)).timestamp()),
        }
        defaults.update(claims)
        return jwt.encode(defaults, self.secret, algorithm="HS256")

    def test_verify_valid_token(self):
        verifier = self._make_verifier()
        token = self._make_token()
        payload = verifier.verify_token(token)
        assert payload["sub"] == "1"

    def test_verify_missing_token(self):
        verifier = self._make_verifier()
        with pytest.raises(JWTVerificationError, match="Missing"):
            verifier.verify_token("")

    def test_verify_expired_token(self):
        verifier = self._make_verifier()
        token = self._make_token(exp=int((datetime.now(UTC) - timedelta(hours=1)).timestamp()))
        with pytest.raises(JWTVerificationError) as exc_info:
            verifier.verify_token(token)
        assert exc_info.value.code == "expired"

    def test_verify_invalid_token(self):
        verifier = self._make_verifier()
        with pytest.raises(JWTVerificationError) as exc_info:
            verifier.verify_token("not.a.jwt")
        assert exc_info.value.code == "invalid"

    def test_missing_secret_raises(self):
        verifier = self._make_verifier(secret=None)
        with pytest.raises(JWTVerificationError, match="JWT_SECRET"):
            verifier.verify_token(self._make_token())

    def test_missing_public_key_raises(self):
        verifier = self._make_verifier(provider="public_key", public_key=None)
        with pytest.raises(JWTVerificationError, match="JWT_PUBLIC_KEY"):
            verifier.verify_token(self._make_token())

    def test_missing_jwks_client_raises(self):
        verifier = self._make_verifier(provider="jwks", jwks_url=None)
        with pytest.raises(JWTVerificationError, match="JWT_JWKS_URL"):
            verifier.verify_token(self._make_token())

    def test_decode_options(self):
        verifier = self._make_verifier(require_exp=False, verify_nbf=False)
        opts = verifier._decode_options()
        assert opts["verify_exp"] is False
        assert opts["verify_nbf"] is False

    def test_decode_kwargs_with_issuer_audience(self):
        verifier = self._make_verifier(issuer="https://issuer", audience="my-app")
        kwargs = verifier._decode_kwargs()
        assert kwargs["issuer"] == "https://issuer"
        assert kwargs["audience"] == "my-app"

    def test_from_env(self):
        verifier = JWTVerifier.from_env()
        assert verifier is not None
