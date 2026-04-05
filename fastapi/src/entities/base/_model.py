from collections.abc import Iterator

from sqlalchemy import BigInteger, Column, DateTime, Integer, func
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class BaseModel_(Base):
    __abstract__ = True
    __table_args__ = {"extend_existing": True}

    # ── Serialisation ────────────────────────────────────────────────────
    __hidden_fields__: set[str] = set()
    __searchable_fields__: set[str] = set()

    # ── API configuration (set on subclasses) ────────────────────────────
    __api_prefix__: str | None = None  # e.g. "/users" — defaults to tablename with hyphens
    __api_tags__: list | None = None  # OpenAPI tags — defaults to [api_prefix]
    __readonly__: bool = False  # True = only GET endpoints registered
    __soft_delete__: bool = False  # True = adds deleted_at column, filters by default
    __bulk_operations__: bool = True  # True = registers /bulk endpoints
    __create_fields__: set[str] | None = None  # Fields allowed on create (None = all non-base)
    __update_fields__: set[str] | None = None  # Fields allowed on update (None = all non-base)

    # ── Base columns ─────────────────────────────────────────────────────
    id = Column(
        BigInteger().with_variant(Integer, "sqlite"),
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
    def __init__(self, model_name: str, id: int):
        self.model_name = model_name
        self.id = id
        super().__init__(f"{model_name} not found with id {id}")


class BusinessRuleError(Exception):
    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)
