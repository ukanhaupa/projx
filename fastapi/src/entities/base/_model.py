from collections.abc import Iterator
from typing import Any

from sqlalchemy import BigInteger, Column, DateTime, event, func
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


_BUILT_IN_PRIVATE_COLUMNS: frozenset[str] = frozenset(
    {
        "password",
        "password_hash",
        "secret",
        "secret_hash",
        "token_hash",
        "refresh_token_jti",
        "mfa_secret",
        "recovery_codes",
        "salt",
        "api_key",
        "private_key",
        "encryption_key",
    }
)


class BaseModel_(Base):
    __abstract__ = True
    __table_args__ = {"extend_existing": True}
    __allow_unmapped__ = True

    __hidden_fields__: set[str] = set()
    __searchable_fields__: set[str] = set()

    __api_prefix__: str | None = None
    __api_tags__: list | None = None
    __readonly__: bool = False
    __private__: bool = False
    __soft_delete__: bool = False
    __bulk_operations__: bool = True
    __create_fields__: set[str] | None = None
    __update_fields__: set[str] | None = None

    id = Column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
        nullable=False,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __iter__(self) -> Iterator[tuple[str, object]]:
        for c in self.__table__.columns:
            if c.key not in self.__hidden_fields__:
                yield c.key, getattr(self, c.key)


class SoftDeleteMixin:
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class NotFoundError(Exception):
    def __init__(self, model_name: str, id: str | int):
        self.model_name = model_name
        self.id = id
        super().__init__(f"{model_name} not found with id {id}")


class BusinessRuleError(Exception):
    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)


@event.listens_for(BaseModel_, "instrument_class", propagate=True)
def _apply_built_in_private_columns(mapper: Any, cls: type[BaseModel_]) -> None:
    if cls is BaseModel_ or cls.__dict__.get("__abstract__", False):
        return
    if not hasattr(cls, "__table__"):
        return
    col_names = {c.key for c in cls.__table__.columns}
    existing = set(cls.__dict__.get("__hidden_fields__", set()) or set())
    cls.__hidden_fields__ = existing | (_BUILT_IN_PRIVATE_COLUMNS & col_names)
