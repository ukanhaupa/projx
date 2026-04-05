import os
from dataclasses import dataclass
from typing import Literal

import jwt
from jwt import (
    ExpiredSignatureError,
    ImmatureSignatureError,
    InvalidIssuedAtError,
    InvalidTokenError,
    PyJWKClient,
)

JWTProvider = Literal["shared_secret", "public_key", "jwks"]
JWTVerificationCode = Literal["missing", "invalid", "expired", "misconfigured"]

_ALLOWED_ALGORITHMS = {
    "HS256",
    "HS384",
    "HS512",
    "RS256",
    "RS384",
    "RS512",
    "ES256",
    "ES384",
    "ES512",
    "PS256",
    "PS384",
    "PS512",
}


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_csv(value: str | None, default: list[str]) -> list[str]:
    if value is None:
        return default
    parsed = [part.strip() for part in value.split(",") if part.strip()]
    return parsed or default


def _parse_positive_int(value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        parsed = int(value.strip())
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _optional_env(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed if trimmed else None


def _without_trailing_slash(value: str) -> str:
    return value[:-1] if value.endswith("/") else value


def _parse_algorithms(value: str | None, defaults: list[str]) -> list[str]:
    parsed = [
        algorithm.strip().upper()
        for algorithm in _parse_csv(value, defaults)
        if algorithm.strip().upper() in _ALLOWED_ALGORITHMS
    ]
    unique = list(dict.fromkeys(parsed))
    return unique or defaults


def _infer_provider(
    explicit_provider: str | None,
    jwks_url: str | None,
    public_key: str | None,
) -> JWTProvider:
    normalized = (explicit_provider or "auto").strip().lower()
    if normalized in {"shared_secret", "public_key", "jwks"}:
        return normalized  # type: ignore[return-value]
    if jwks_url:
        return "jwks"
    if public_key:
        return "public_key"
    return "shared_secret"


class JWTVerificationError(Exception):
    def __init__(self, code: JWTVerificationCode, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class JWTVerificationConfig:
    provider: JWTProvider
    algorithms: list[str]
    secret: str | None
    public_key: str | None
    jwks_url: str | None
    jwks_timeout_ms: int
    jwks_cache_ttl_sec: int
    jwks_cache_max_keys: int
    issuer: str | None
    audience: str | None
    require_exp: bool
    verify_nbf: bool
    verify_iat: bool

    @classmethod
    def from_env(cls) -> "JWTVerificationConfig":
        issuer = _optional_env(os.getenv("JWT_ISSUER"))
        explicit_jwks_url = _optional_env(os.getenv("JWT_JWKS_URL"))
        inferred_jwks_url = f"{_without_trailing_slash(issuer)}/protocol/openid-connect/certs" if issuer else None
        jwks_url = explicit_jwks_url or inferred_jwks_url
        public_key = _optional_env(os.getenv("JWT_PUBLIC_KEY"))
        provider = _infer_provider(
            os.getenv("JWT_PROVIDER"),
            jwks_url,
            public_key,
        )
        default_algorithms = ["HS256"] if provider == "shared_secret" else ["RS256"]

        return cls(
            provider=provider,
            algorithms=_parse_algorithms(os.getenv("JWT_ALGORITHMS"), default_algorithms),
            secret=_optional_env(os.getenv("JWT_SECRET")),
            public_key=public_key,
            jwks_url=jwks_url,
            jwks_timeout_ms=_parse_positive_int(os.getenv("JWT_JWKS_TIMEOUT_MS"), 3000),
            jwks_cache_ttl_sec=_parse_positive_int(os.getenv("JWT_JWKS_CACHE_TTL_SEC"), 300),
            jwks_cache_max_keys=_parse_positive_int(os.getenv("JWT_JWKS_CACHE_MAX_KEYS"), 100),
            issuer=issuer,
            audience=_optional_env(os.getenv("JWT_AUDIENCE")),
            require_exp=_parse_bool(os.getenv("JWT_REQUIRE_EXP"), True),
            verify_nbf=_parse_bool(os.getenv("JWT_VERIFY_NBF"), True),
            verify_iat=_parse_bool(os.getenv("JWT_VERIFY_IAT"), False),
        )


class JWTVerifier:
    def __init__(self, config: JWTVerificationConfig):
        self.config = config
        self._jwks_client: PyJWKClient | None = None
        if self.config.provider == "jwks" and self.config.jwks_url:
            try:
                self._jwks_client = PyJWKClient(
                    self.config.jwks_url,
                    cache_keys=True,
                    max_cached_keys=self.config.jwks_cache_max_keys,
                    cache_jwk_set=True,
                    lifespan=self.config.jwks_cache_ttl_sec,
                    timeout=max(self.config.jwks_timeout_ms / 1000, 0.1),
                )
            except TypeError:
                self._jwks_client = PyJWKClient(self.config.jwks_url)

    @classmethod
    def from_env(cls) -> "JWTVerifier":
        return cls(JWTVerificationConfig.from_env())

    def _decode_options(self) -> dict:
        return {
            "verify_signature": True,
            "verify_exp": self.config.require_exp,
            "verify_nbf": self.config.verify_nbf,
            "verify_iat": self.config.verify_iat,
            "verify_iss": bool(self.config.issuer),
            "verify_aud": bool(self.config.audience),
            "require": ["exp"] if self.config.require_exp else [],
        }

    def _decode_kwargs(self) -> dict:
        kwargs: dict = {
            "algorithms": self.config.algorithms,
            "options": self._decode_options(),
        }
        if self.config.issuer:
            kwargs["issuer"] = self.config.issuer
        if self.config.audience:
            kwargs["audience"] = self.config.audience
        return kwargs

    def _resolve_key_for_token(self, token: str):
        provider = self.config.provider

        if provider == "shared_secret":
            if not self.config.secret:
                raise JWTVerificationError(
                    "misconfigured",
                    "JWT_SECRET is required when JWT_PROVIDER=shared_secret",
                )
            return self.config.secret

        if provider == "public_key":
            if not self.config.public_key:
                raise JWTVerificationError(
                    "misconfigured",
                    "JWT_PUBLIC_KEY is required when JWT_PROVIDER=public_key",
                )
            return self.config.public_key

        if provider == "jwks":
            if not self._jwks_client:
                raise JWTVerificationError(
                    "misconfigured",
                    "JWT_JWKS_URL or JWT_ISSUER is required when JWT_PROVIDER=jwks",
                )
            try:
                return self._jwks_client.get_signing_key_from_jwt(token).key
            except Exception as exc:
                raise JWTVerificationError("invalid", f"Unable to resolve JWKS signing key: {exc}") from exc

        raise JWTVerificationError(
            "misconfigured",
            "Unsupported JWT_PROVIDER. Use one of: shared_secret, public_key, jwks, auto",
        )

    def verify_token(self, token: str) -> dict:
        if not token:
            raise JWTVerificationError("missing", "Missing bearer token")

        key = self._resolve_key_for_token(token)
        try:
            decoded = jwt.decode(token, key=key, **self._decode_kwargs())
        except ExpiredSignatureError as exc:
            raise JWTVerificationError("expired", "Token expired") from exc
        except (ImmatureSignatureError, InvalidIssuedAtError) as exc:
            raise JWTVerificationError("invalid", str(exc)) from exc
        except InvalidTokenError as exc:
            raise JWTVerificationError("invalid", str(exc)) from exc
        if not isinstance(decoded, dict):
            raise JWTVerificationError("invalid", "Decoded token payload is not an object")
        return decoded


_jwt_verifier: JWTVerifier | None = None


def get_jwt_verifier() -> JWTVerifier:
    global _jwt_verifier
    if _jwt_verifier is None:
        _jwt_verifier = JWTVerifier.from_env()
    return _jwt_verifier


def reset_jwt_verifier() -> None:
    global _jwt_verifier
    _jwt_verifier = None


def verify_jwt_token(token: str) -> dict:
    return get_jwt_verifier().verify_token(token)
