import { createServer } from 'node:http';
import { buildApp } from './app.js';
import { config } from './config.js';
import { closeDatabase } from './db/client.js';

const app = buildApp();
const server = createServer(app);

server.listen(config.PORT, config.HOST, () => {
  console.log(`Express API listening on http://${config.HOST}:${config.PORT}`);
});

function shutdown(signal: string): void {
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
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
