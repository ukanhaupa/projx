from sqlalchemy import Boolean, Column, String, Text

from ..base._model import BaseModel_


class ServiceConfig(BaseModel_):
    __tablename__ = "service_configs"
    __private__ = True

    purpose = Column(String(64), nullable=False, unique=True)
    config = Column(Text, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
