import { createServer } from 'node:http';
import pino from 'pino';
import { buildApp, setReadiness } from './app.js';
import { config } from './config.js';
import {
  SENTRY_PURPOSE,
  initSentry,
  normalizeSentryConfig,
} from './lib/sentry.js';
import { getServiceConfig } from './lib/service-config.js';
import { prisma } from './prisma.js';

const log = pino({ level: config.LOG_LEVEL });

async function start(): Promise<void> {
  initSentry(
    normalizeSentryConfig(await getServiceConfig(prisma, SENTRY_PURPOSE)),
  );

  const app = buildApp();
  const server = createServer(app);

  server.listen(config.PORT, config.HOST, () => {
    setReadiness(true);
    log.info(`Express API listening on http://${config.HOST}:${config.PORT}`);
  });

  function shutdown(signal: string): void {
    log.info(`${signal} received, draining`);
    setReadiness(false);
    setTimeout(() => {
      server.close((err) => {
        if (err) {
          log.error({ err }, 'error closing server');
          process.exit(1);
        }
        process.exit(0);
      });
    }, 5_000).unref();
    setTimeout(() => process.exit(1), 20_000).unref();
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  log.error({ err }, 'failed to start server');
  process.exit(1);
});
