import fp from 'fastify-plugin';

export default fp(async (fastify) => {
  fastify.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    const contentType = reply.getHeader('content-type');
    if (
      typeof contentType !== 'string' ||
      !contentType.includes('application/json')
    )
      return payload;
    if (typeof payload !== 'string') return payload;
    try {
      const body = JSON.parse(payload);
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return payload;
      if (!('detail' in body) || 'request_id' in body) return payload;
      return JSON.stringify({ ...body, request_id: request.id });
    } catch {
      return payload;
    }
  });
});
