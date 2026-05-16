import 'reflect-metadata';
import { createServer } from 'node:http';
import { buildApp } from './app.js';
import { config } from './config.js';
import { closeDatabase, dataSource } from './db/data-source.js';

async function main(): Promise<void> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const app = buildApp();
  const server = createServer(app);

  server.listen(config.PORT, config.HOST, () => {
    console.log(
      `Express API listening on http://${config.HOST}:${config.PORT}`,
    );
  });

  const shutdown = (signal: string): void => {
    console.log(`${signal} received, closing HTTP server`);
    server.close((err) => {
      closeDatabase()
        .catch((closeErr: unknown) => {
          console.error(closeErr);
        })
        .finally(() => {
          if (err) {
            console.error(err);
            process.exit(1);
          }
          process.exit(0);
        });
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
