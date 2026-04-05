import fp from 'fastify-plugin';
import { Prisma } from '@prisma/client';
import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { NotFoundError, BusinessRuleError } from '../errors.js';

export default fp(async (fastify) => {
  fastify.setErrorHandler(
    (error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
      if ('validation' in error && (error as FastifyError).validation) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: error.message,
        });
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return reply.status(409).send({
            detail: `Resource already exists (${(error.meta?.target as string[])?.join(', ')})`,
            request_id: request.id,
          });
        }
        if (error.code === 'P2003') {
          return reply.status(409).send({
            detail: 'Cannot delete: resource is referenced by other records',
            request_id: request.id,
          });
        }
        if (error.code === 'P2025') {
          return reply.status(404).send({
            detail: 'Record not found',
            request_id: request.id,
          });
        }
      }

      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          detail: error.message,
          request_id: request.id,
        });
      }

      if (error instanceof BusinessRuleError) {
        return reply.status(422).send({
          detail: error.detail,
          request_id: request.id,
        });
      }

      request.log.error(error);
      const statusCode = 'statusCode' in error ? ((error as FastifyError).statusCode ?? 500) : 500;
      return reply.status(statusCode).send({
        detail: statusCode !== 500 ? error.message : 'Internal server error',
        request_id: request.id,
      });
    },
  );
});
