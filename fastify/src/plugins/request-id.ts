import fp from 'fastify-plugin';

export default fp(async (fastify) => {
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
});
