import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AccessPolicy, EventBus, type AppContext } from '@opsis/core';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { systemClock } from './infrastructure/clock.js';
import { Database } from './infrastructure/db/database.js';
import { createRepositories } from './infrastructure/db/repositories.js';
import { FileBlobStore } from './infrastructure/files/blob-store.js';
import { SharpImageInspector } from './infrastructure/files/image-inspector.js';

/** Composition root: wires infrastructure into the application context and starts the server. */
const main = async (): Promise<void> => {
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });
  const db = Database.open(join(config.dataDir, 'opsis.db'));
  const repos = createRepositories(db);

  // The logger only exists once the app is built; until then listener errors go to stderr.
  let reportListenerError = (error: unknown, eventType: string): void => {
    console.error(`event listener failed (${eventType})`, error);
  };
  const bus = new EventBus((error, event) => {
    reportListenerError(error, event.type);
  });

  const ctx: AppContext = {
    repos,
    tx: db,
    clock: systemClock,
    events: bus,
    access: new AccessPolicy(repos.grants),
    images: new SharpImageInspector(),
    blobs: new FileBlobStore(join(config.dataDir, 'blobs')),
  };

  const app = await buildApp({
    ctx,
    bus,
    allowedHosts: config.allowedHosts,
    logger: { level: config.logLevel },
  });
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

await main();
