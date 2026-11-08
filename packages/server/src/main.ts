import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventBus } from '@opsis/core';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createAppContext } from './context.js';
import { Database } from './infrastructure/db/database.js';

/** Composition root: wires infrastructure into the application context and starts the server. */
export const startServer = async (): Promise<void> => {
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });
  const db = Database.open(join(config.dataDir, 'opsis.db'));

  // The logger only exists once the app is built; until then listener errors go to stderr.
  let reportListenerError = (error: unknown, eventType: string): void => {
    console.error(`event listener failed (${eventType})`, error);
  };
  const bus = new EventBus((error, event) => {
    reportListenerError(error, event.type);
  });
  const ctx = createAppContext(db, config.dataDir, bus);

  const app = await buildApp({
    ctx,
    bus,
    allowedHosts: config.allowedHosts,
    publicUrl: config.publicUrl,
    logger: { level: config.logLevel },
    ...(config.webRoot === undefined ? {} : { webRoot: config.webRoot }),
  });
  if (config.webRoot === undefined) {
    app.log.warn('web UI not built (npm run build) – serving the API only');
  }
  reportListenerError = (error, eventType) => {
    app.log.error({ err: error, event: eventType }, 'event listener failed');
  };

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
};

// `node dist/main.js` starts the server directly; the CLI imports `startServer`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
}
