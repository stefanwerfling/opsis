import { join } from 'node:path';
import { AccessPolicy, type AppContext, type EventBus } from '@opsis/core';
import { systemClock } from './infrastructure/clock.js';
import type { Database } from './infrastructure/db/database.js';
import { createRepositories } from './infrastructure/db/repositories.js';
import { SharpImageAnnotator } from './infrastructure/files/annotator.js';
import { ZipArchiveCodec } from './infrastructure/files/archive.js';
import { FileBlobStore } from './infrastructure/files/blob-store.js';
import { PixelmatchImageDiffer } from './infrastructure/files/differ.js';
import { SharpImageInspector } from './infrastructure/files/image-inspector.js';
import { nodeHasher } from './infrastructure/hash.js';

/** Wires the infrastructure into the application context (server and CLI). */
export const createAppContext = (db: Database, dataDir: string, bus: EventBus): AppContext => {
  const repos = createRepositories(db);
  return {
    repos,
    tx: db,
    clock: systemClock,
    events: bus,
    access: new AccessPolicy(repos.grants),
    images: new SharpImageInspector(),
    annotator: new SharpImageAnnotator(),
    differ: new PixelmatchImageDiffer(),
    archives: new ZipArchiveCodec(),
    blobs: new FileBlobStore(join(dataDir, 'blobs')),
    hash: nodeHasher,
  };
};
