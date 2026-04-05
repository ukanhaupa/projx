import { config } from './config.js';
import { buildApp } from './app.js';

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    app.log.info(`Server listening on http://${config.HOST}:${config.PORT}`);
    app.log.info(`Swagger docs available at http://${config.HOST}:${config.PORT}/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
