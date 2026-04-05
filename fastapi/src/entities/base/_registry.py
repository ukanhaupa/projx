from __future__ import annotations

import builtins
import importlib
import os
import re
from dataclasses import dataclass, field
from typing import Any

import sqlalchemy.exc
from fastapi import APIRouter, Body, HTTPException, Query, Request
from loguru import logger
from starlette.responses import Response
from starlette.status import HTTP_201_CREATED

from ._auto_schema import create_create_schema, create_update_schema, get_field_metadata
from ._controller import BaseController
from ._expand import ExpandResolver
from ._model import Base, BaseModel_, BusinessRuleError
from ._repository import BaseRepository
from ._service import BaseService


@dataclass
class EntityMeta:
    model: type[BaseModel_]
    name: str
    api_prefix: str
    api_tags: list
    readonly: bool
    soft_delete: bool
    bulk_operations: bool
    searchable_fields: list = field(default_factory=list)
    fields: list = field(default_factory=list)


class EntityRegistry:
    _entities: dict[str, EntityMeta] = {}
    _custom_controllers: dict[str, type] = {}

    @classmethod
    def reset(cls):
        cls._entities = {}
        cls._custom_controllers = {}

    @classmethod
    def _import_all_entity_modules(cls):
        entities_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        if not os.path.isdir(entities_dir):
            logger.warning(f"Entities directory not found: {entities_dir}")
            return
        for item in sorted(os.listdir(entities_dir)):
            item_path = os.path.join(entities_dir, item)
            if not os.path.isdir(item_path) or item.startswith("_") or item == "base":
                continue
            model_file = os.path.join(item_path, "_model.py")
            if not os.path.isfile(model_file):
                logger.debug(f"Skipping entity directory {item}: no _model.py")
                continue
            try:
                importlib.import_module(f"src.entities.{item}._model")
            except (ImportError, ModuleNotFoundError) as e:
                logger.warning(f"Failed to import entity {item}: {e}")
                continue
            except Exception as e:
                logger.error(f"Unexpected error importing entity {item}: {e}")
                continue

            try:
                ctrl_mod = importlib.import_module(f"src.entities.{item}._controller")
                for attr_name in dir(ctrl_mod):
                    attr = getattr(ctrl_mod, attr_name)
                    if isinstance(attr, type) and issubclass(attr, BaseController) and attr is not BaseController:
                        cls._custom_controllers[attr_name] = attr
            except (ImportError, ModuleNotFoundError):
                pass

    @classmethod
    def auto_discover(cls):
        cls._import_all_entity_modules()

        for mapper in Base.registry.mappers:
            model_cls = mapper.class_
            if model_cls is BaseModel_ or model_cls.__dict__.get("__abstract__", False):
                continue
            if not hasattr(model_cls, "__tablename__"):
                continue

            table_name = model_cls.__tablename__
            if table_name in cls._entities:
                continue

            api_prefix = getattr(model_cls, "__api_prefix__", None) or "/" + table_name.replace("_", "-")
            if not re.match(r"^/[a-z0-9][a-z0-9\-]*$", api_prefix):
                logger.warning(
                    f"Skipping {model_cls.__name__}: invalid __api_prefix__ '{api_prefix}' (must match /[a-z0-9-]+)"
                )
                continue

            soft_delete = getattr(model_cls, "__soft_delete__", False)
            if soft_delete:
                col_names = {c.key for c in model_cls.__table__.columns}
                if "deleted_at" not in col_names:
                    logger.warning(
                        f"Skipping {model_cls.__name__}: __soft_delete__=True but no 'deleted_at' column. Use SoftDeleteMixin."
                    )
                    continue

            api_tags = getattr(model_cls, "__api_tags__", None) or [api_prefix.lstrip("/")]
            searchable = list(getattr(model_cls, "__searchable_fields__", set()))

            meta = EntityMeta(
                model=model_cls,
                name=model_cls.__name__,
                api_prefix=api_prefix,
                api_tags=api_tags,
                readonly=getattr(model_cls, "__readonly__", False),
                soft_delete=soft_delete,
                bulk_operations=getattr(model_cls, "__bulk_operations__", True),
                searchable_fields=searchable,
                fields=get_field_metadata(model_cls),
            )
            cls._entities[table_name] = meta
            logger.debug(f"Registered entity: {model_cls.__name__} -> {api_prefix}")

    @classmethod
    def _build_controller(cls, meta: EntityMeta):
        custom_cls = cls._custom_controllers.get(f"{meta.name}Controller")
        if custom_cls:
            logger.debug(f"Using custom controller for {meta.name}")
            return custom_cls()

        model = meta.model
        repo_cls = type(
            f"{model.__name__}Repository",
            (BaseRepository,),
            {
                "__init__": lambda self, m=model: BaseRepository.__init__(self, m),
            },
        )
        service_cls = type(
            f"{model.__name__}Service",
            (BaseService,),
            {
                "__init__": lambda self, r=repo_cls: BaseService.__init__(self, r),
            },
        )

        if meta.readonly:
            return _ReadOnlyController(service_cls)
        return _AutoController(
            service_cls,
            create_create_schema(model),
            create_update_schema(model),
            meta.bulk_operations,
        )

    @classmethod
    def create_router(cls) -> APIRouter:
        cls.auto_discover()
        router = APIRouter(prefix="/v1")

        for _table_name, meta in cls._entities.items():
            ctrl = cls._build_controller(meta)
            router.include_router(ctrl.router, prefix=meta.api_prefix, tags=meta.api_tags)
            logger.debug(f"Mounted {meta.name} at {meta.api_prefix}")

        router.add_api_route("/_meta", cls._meta_endpoint, methods=["GET"], tags=["meta"])
        return router

    @classmethod
    async def _meta_endpoint(cls) -> dict[str, Any]:
        return {
            "entities": [
                {
                    "name": m.name,
                    "table_name": tn,
                    "api_prefix": m.api_prefix,
                    "tags": m.api_tags,
                    "readonly": m.readonly,
                    "soft_delete": m.soft_delete,
                    "bulk_operations": m.bulk_operations and not m.readonly,
                    "searchable_fields": m.searchable_fields,
                    "fields": m.fields,
                }
                for tn, m in cls._entities.items()
            ]
        }

    @classmethod
    def get_entities(cls) -> dict[str, EntityMeta]:
        return dict(cls._entities)


class _ReadOnlyController:
    def __init__(self, service_cls: type[BaseService]):
        self.router = APIRouter()
        self.service = service_cls()
        self.router.get("/")(self.list)
        self.router.get("/{id}")(self.get)

    async def _maybe_expand(self, items: list, expand: str | None):
        expand_fields = ExpandResolver.parse(expand or "")
        if not expand_fields:
            return items
        return await ExpandResolver.resolve(items, expand_fields, self.service.repository.model)

    async def list(
        self,
        request: Request,
        page: int = Query(1, ge=1),
        page_size: int = Query(10, ge=1, le=100),
        order_by: builtins.list[str] | None = Query([]),
        search: str | None = Query(None),
        expand: str | None = Query(None),
    ):
        try:
            filter_by = {k: v for k, v in request.query_params.items() if k not in BaseController._RESERVED_PARAMS}
            result, total = await self.service.list_with_count(
                page=page,
                page_size=page_size,
                filter_by=filter_by,
                order_by=order_by,
                search=search,
            )
            data = await self._maybe_expand(result, expand)
            if not expand:
                data = [dict(item) if not isinstance(item, dict) else item for item in data]
            return {
                "data": data,
                "pagination": {
                    "current_page": page,
                    "page_size": page_size,
                    "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
                    "total_records": total,
                },
            }
        except BusinessRuleError as e:
            raise HTTPException(status_code=422, detail=e.detail)
        except (sqlalchemy.exc.SQLAlchemyError, ValueError) as e:
            logger.warning(f"Bad request in readonly list: {e}")
            raise HTTPException(status_code=400, detail="Invalid request data")
        except HTTPException:
            raise
        except Exception as e:
            logger.exception(e)
            raise HTTPException(status_code=500, detail="Internal server error")

    async def get(self, id: int, expand: str | None = Query(None)):
        try:
            result = await self.service.get(id=id)
            if not result:
                raise HTTPException(status_code=404, detail="Not found")
            if expand:
                data = await self._maybe_expand([result], expand)
                return data[0]
            return dict(result)
        except HTTPException:
            raise
        except Exception as e:
            logger.exception(e)
            raise HTTPException(status_code=500, detail="Internal server error")


class _AutoController(BaseController):
    def __init__(
        self,
        service_cls: type[BaseService],
        create_schema: type,
        update_schema: type,
        bulk_operations: bool = True,
    ):
        super().__init__(service_cls)
        self._create_schema = create_schema
        self._update_schema = update_schema

        self.router.routes.clear()
        self.router.post("/", status_code=HTTP_201_CREATED)(self._make_create(create_schema))
        self.router.get("/")(self.list)
        self.router.get("/{id}")(self.get)
        self.router.patch("/{id}")(self._make_patch(update_schema))
        self.router.delete("/{id}")(self.delete)
        if bulk_operations:
            self.router.post("/bulk", status_code=HTTP_201_CREATED)(self._make_bulk_create(create_schema))
            self.router.delete("/bulk")(self.bulk_delete)

    def _make_create(self, schema: type):
        parent = self

        async def create(request: Request, data: Any = Body(...)):
            return await BaseController.create(parent, request=request, data=data.model_dump(exclude_unset=True))

        create.__annotations__["data"] = schema
        return create

    def _make_patch(self, schema: type):
        parent = self

        async def patch(id: int, request: Request, data: Any = Body(...)):
            return await BaseController.patch(parent, id=id, request=request, data=data.model_dump(exclude_unset=True))

        patch.__annotations__["data"] = schema
        return patch

    def _make_bulk_create(self, schema: type):
        parent = self

        async def bulk_create(request: Request, items: Any = Body(...)):
            try:
                scope_filters = await parent._get_scope_filters(request)
                data_list = []
                for item in items:
                    data = item.model_dump(exclude_unset=True)
                    if scope_filters is not None:
                        data.update(scope_filters)
                    data_list.append(data)
                results = await parent.service.bulk_create(data_list)
                return {"data": [dict(r) for r in results], "count": len(results)}
            except sqlalchemy.exc.IntegrityError as e:
                logger.warning(f"Conflict in bulk_create: {e}")
                raise HTTPException(
                    status_code=409,
                    detail="One or more resources already exist or violate a constraint",
                )
            except BusinessRuleError as e:
                raise HTTPException(status_code=422, detail=e.detail)
            except (sqlalchemy.exc.SQLAlchemyError, ValueError) as e:
                logger.warning(f"Bad request in bulk_create: {e}")
                raise HTTPException(status_code=400, detail="Invalid request data")
            except HTTPException:
                raise
            except Exception as e:
                logger.exception(e)
                raise HTTPException(status_code=500, detail="Internal server error")

        bulk_create.__annotations__["items"] = list[schema]
        return bulk_create

    async def bulk_delete(self, request: Request, ids: list[int] = Body(...)):
        try:
            scope_filters = await self._get_scope_filters(request)
            if scope_filters is not None:
                accessible = await self.service.list(
                    page=1,
                    page_size=len(ids),
                    filter_by={**scope_filters, "id__in": ",".join(str(i) for i in ids)},
                )
                ids = [r.id for r in accessible]
            if ids:
                await self.service.bulk_delete(ids)
            return Response(status_code=204)
        except sqlalchemy.exc.IntegrityError as e:
            logger.warning(f"Conflict in bulk_delete: {e}")
            raise HTTPException(
                status_code=409,
                detail="Cannot delete: one or more resources are referenced by other records",
            )
        except BusinessRuleError as e:
            raise HTTPException(status_code=422, detail=e.detail)
        except (sqlalchemy.exc.SQLAlchemyError, ValueError) as e:
            logger.warning(f"Bad request in bulk_delete: {e}")
            raise HTTPException(status_code=400, detail="Invalid request data")
        except HTTPException:
            raise
        except Exception as e:
            logger.exception(e)
            raise HTTPException(status_code=500, detail="Internal server error")
