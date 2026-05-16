import { config } from './config.js';
import { buildApp } from './app.js';
import { gracefulShutdown } from './lib/shutdown.js';

async function start() {
  const app = await buildApp();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void gracefulShutdown(app, signal);
    });
  }

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    app.log.info(`Server listening on http://${config.HOST}:${config.PORT}`);
    app.log.info(
      `Swagger docs available at http://${config.HOST}:${config.PORT}/docs`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
