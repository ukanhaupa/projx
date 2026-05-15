import type { ErrorRequestHandler, RequestHandler } from 'express';

export class ApiError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, message: string, code = 'error') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class NotFoundError extends ApiError {
  constructor(entity: string, id: string) {
    super(404, `${entity} with id "${id}" not found`, 'not_found');
  }
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new ApiError(404, `Route not found: ${req.method} ${req.path}`, 'not_found'));
};

type ErrorWithCode = Error & {
  code?: unknown;
  meta?: {
    target?: unknown;
  };
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const coded = err as ErrorWithCode;
  const isConflict = coded.code === 'P2002';
  const statusCode = isConflict ? 409 : err instanceof ApiError ? err.statusCode : 500;
  const code = isConflict ? 'conflict' : err instanceof ApiError ? err.code : 'internal_error';
  const message = err instanceof Error ? err.message : 'Internal server error';

  res.status(statusCode).json({
    error: {
      code,
      message,
      target: isConflict ? coded.meta?.target : undefined,
      request_id: res.locals.requestId,
    },
  });
};
