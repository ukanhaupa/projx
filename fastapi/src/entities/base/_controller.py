from typing import Any, Generic, TypeVar, cast

import sqlalchemy.exc
from fastapi import APIRouter, Body, HTTPException, Query, Request
from loguru import logger
from starlette.responses import Response
from starlette.status import HTTP_201_CREATED

from src.middlewares import compute_scope_filters

from ._expand import ExpandResolver
from ._model import BusinessRuleError, NotFoundError
from ._service import BaseService

ServiceT = TypeVar("ServiceT", bound=BaseService)


class BaseController(Generic[ServiceT]):
    _RESERVED_PARAMS = {"page", "page_size", "order_by", "search", "expand"}

    def __init__(self, service: type[ServiceT]):
        self.router = APIRouter()
        self.service = cast("ServiceT", cast("Any", service)())

        self.router.post("/", status_code=HTTP_201_CREATED)(self.create)
        self.router.get("/")(self.list)
        self.router.get("/{id}")(self.get)
        self.router.patch("/{id}")(self.patch)
        self.router.delete("/{id}")(self.delete)

    def _service(self) -> ServiceT:
        return self.service

    async def _get_scope_filters(self, request: Request) -> dict[str, Any] | None:
        user = getattr(request.state, "user", None)
        model = self._service().repository.model
        table_name = model.__tablename__
        column_names = {c.key for c in model.__table__.columns}
        return await compute_scope_filters(user, table_name, column_names)

    def _extract_filter_by(self, request: Request) -> dict[str, Any]:
        if not request.query_params:
            return {}
        return {k: v for k, v in request.query_params.items() if k not in self._RESERVED_PARAMS}

    async def _maybe_expand(self, items: list, expand: str | None):
        expand_fields = ExpandResolver.parse(expand or "")
        if not expand_fields:
            return items
        return await ExpandResolver.resolve(items, expand_fields, self._service().repository.model)

    async def create(self, request: Request, data: dict = Body(...)):
        logger.debug(f"{self._service().repository.model.__name__}: Create called")
        try:
            service = self._service()
            scope_filters = await self._get_scope_filters(request)
            if scope_filters is not None:
                data.update(scope_filters)
            result = await service.create(data)
            return result
        except sqlalchemy.exc.IntegrityError as e:
            logger.warning(f"Conflict in create: {e}")
            raise HTTPException(
                status_code=409,
                detail="Resource already exists or violates a constraint",
            )
        except NotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except BusinessRuleError as e:
            raise HTTPException(status_code=422, detail=e.detail)
        except (sqlalchemy.exc.SQLAlchemyError, ValueError) as e:
            logger.warning(f"Bad request in create: {e}")
            raise HTTPException(status_code=400, detail="Invalid request data")
        except HTTPException as e:
            logger.warning(e)
            raise e
        except Exception as e:
            logger.exception(e)
            raise HTTPException(status_code=500, detail="Internal server error")

    async def list(
        self,
        request: Request,
        page: int = Query(1, ge=1),
        page_size: int = Query(10, ge=1, le=100),
        order_by: list[str] | None = Query([]),
        search: str | None = Query(None),
        expand: str | None = Query(None),
    ):
        logger.debug(f"{self._service().repository.model.__name__}: List with page: {page}, page_size: {page_size}")
        try:
            service = self._service()
            filter_by = self._extract_filter_by(request)
            scope_filters = await self._get_scope_filters(request)
            if scope_filters is not None:
                filter_by.update(scope_filters)
            result, total_records = await service.list_with_count(
                page=page,
                page_size=page_size,
                filter_by=filter_by,
                order_by=order_by,
                search=search,
            )
            data = await self._maybe_expand(result, expand)
            return {
                "data": data,
                "pagination": {
                    "current_page": page,
                    "page_size": page_size,
                    "total_pages": (total_records + page_size - 1) // page_size if total_records > 0 else 0,
                    "total_records": total_records,
                },
            }
        except BusinessRuleError as e:
            raise HTTPException(status_code=422, detail=e.detail)
        except (sqlalchemy.exc.SQLAlchemyError, ValueError) as e:
            logger.warning(f"Bad request in list: {e}")
            raise HTTPException(status_code=400, detail="Invalid request data")
        except HTTPException as e:
            logger.warning(e)
            raise e
        except Exception as e:
            logger.exception(e)
            raise HTTPException(status_code=500, detail="Internal server error")

    async def get(self, id: int, request: Request, expand: str | None = Query(None)):
        logger.debug(f"{self._service().repository.model.__name__}: Get id: {id}")
        try:
            service = self._service()
            scope_filters = await self._get_scope_filters(request)
            if scope_filters is not None:
                filter_by = {"id": id}
                filter_by.update(scope_filters)
                results = await service.list(page=1, page_size=1, filter_by=filter_by)
                result = results[0] if results else None
            else:
                result = await service.get(id=id)
            if not result:
                raise HTTPException(
                    status_code=404,
                    detail=f"{service.repository.model.__name__} not found",
                )
            if expand:
                data = await self._maybe_expand([result], expand)
                return data[0]
            return result
        except NotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except BusinessRuleError as e:
            raise HTTPException(status_code=422, detail=e.detail)
        except (sqlalchemy.exc.SQLAlchemyError, ValueError) as e:
            logger.warning(f"Bad request in get: {e}")
            raise HTTPException(status_code=400, detail="Invalid request data")
        except HTTPException as e:
            logger.warning(e)
            raise e
        except Exception as e:
            logger.exception(e)
            raise HTTPException(status_code=500, detail="Internal server error")

    async def patch(self, id: int, request: Request, data: dict = Body(...)):
        logger.debug(f"{self._service().repository.model.__name__}: Patch id: {id}")
        try:
            service = self._service()
            if not data:
                raise HTTPException(
                    status_code=400,
                    detail="Request body cannot be empty",
                )
            scope_filters = await self._get_scope_filters(request)
            if scope_filters is not None:
                filter_by = {"id": id}
                filter_by.update(scope_filters)
                results = await service.list(page=1, page_size=1, filter_by=filter_by)
                if not results:
                    raise HTTPException(
                        status_code=404,
                        detail=f"{service.repository.model.__name__} not found",
                    )
            result = await service.patch(id=id, data=data)
            return result
        except sqlalchemy.exc.IntegrityError as e:
            logger.warning(f"Conflict in patch: {e}")
            raise HTTPException(
                status_code=409,
                detail="Update violates a constraint",
            )
        except NotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except BusinessRuleError as e:
            raise HTTPException(status_code=422, detail=e.detail)
        except (sqlalchemy.exc.SQLAlchemyError, ValueError) as e:
            logger.warning(f"Bad request in patch: {e}")
            raise HTTPException(status_code=400, detail="Invalid request data")
        except HTTPException as e:
            logger.warning(e)
            raise e
        except Exception as e:
            logger.exception(e)
            raise HTTPException(status_code=500, detail="Internal server error")

    async def delete(self, id: int, request: Request):
        logger.debug(f"{self._service().repository.model.__name__}: Delete id: {id}")
        try:
            service = self._service()
            scope_filters = await self._get_scope_filters(request)
            if scope_filters is not None:
                filter_by = {"id": id}
                filter_by.update(scope_filters)
                results = await service.list(page=1, page_size=1, filter_by=filter_by)
                if not results:
                    raise HTTPException(
                        status_code=404,
                        detail=f"{service.repository.model.__name__} not found",
                    )
            await service.delete(id=id)
            return Response(status_code=204)
        except sqlalchemy.exc.IntegrityError as e:
            logger.warning(f"Conflict in delete: {e}")
            raise HTTPException(
                status_code=409,
                detail="Cannot delete: resource is referenced by other records",
            )
        except NotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except BusinessRuleError as e:
            raise HTTPException(status_code=422, detail=e.detail)
        except (sqlalchemy.exc.SQLAlchemyError, ValueError) as e:
            logger.warning(f"Bad request in delete: {e}")
            raise HTTPException(status_code=400, detail="Invalid request data")
        except HTTPException as e:
            logger.warning(e)
            raise e
        except Exception as e:
            logger.exception(e)
            raise HTTPException(status_code=500, detail="Internal server error")
