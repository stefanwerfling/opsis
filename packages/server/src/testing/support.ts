import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { AccessPolicy, EventBus, type AppContext, type Clock, type DomainEvent } from '@opsis/core';
import { Database } from '../infrastructure/db/database.js';
import { createRepositories } from '../infrastructure/db/repositories.js';
import { FileBlobStore } from '../infrastructure/files/blob-store.js';
import { nodeHasher } from '../infrastructure/hash.js';
import { SharpImageAnnotator } from '../infrastructure/files/annotator.js';
import { SharpImageInspector } from '../infrastructure/files/image-inspector.js';

export interface TestEnv {
  readonly ctx: AppContext;
  readonly db: Database;
  readonly blobs: FileBlobStore;
  readonly bus: EventBus;
  readonly events: DomainEvent[];
  readonly clock: Clock & { advance(ms: number): void };
  cleanup(): void;
}

/** A complete application context on an in-memory database and a temporary blob directory. */
export const createTestEnv = (): TestEnv => {
  const db = Database.open(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'opsis-test-'));
  const blobs = new FileBlobStore(join(dir, 'blobs'));
  const bus = new EventBus((error) => {
    throw error;
  });
  const events: DomainEvent[] = [];
  bus.subscribe((event) => events.push(event));
  let time = Date.parse('2026-11-07T12:00:00.000Z');
  const clock = {
    now: () => new Date(time).toISOString(),
    advance: (ms: number) => {
      time += ms;
    },
  };
  const repos = createRepositories(db);
  const ctx: AppContext = {
    repos,
    tx: db,
    clock,
    events: bus,
    access: new AccessPolicy(repos.grants),
    images: new SharpImageInspector(),
    annotator: new SharpImageAnnotator(),
    blobs,
    hash: nodeHasher,
  };
  return {
    ctx,
    db,
    blobs,
    bus,
    events,
    clock,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

/** Generates a real image of the given format and size. `seed` varies the content (and hash). */
export const makeImage = async (
  format: 'png' | 'jpeg' | 'webp' = 'png',
  width = 320,
  height = 200,
  seed = 0,
): Promise<Uint8Array<ArrayBuffer>> => {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: (seed * 37) % 256, g: 120, b: 200 } },
  });
  const buffer = await image.toFormat(format).toBuffer();
  return new Uint8Array(buffer);
};

/** Registers an agent row so grants and session ownership can reference it. */
export const insertAgent = (db: Database, id: string, name = id): void => {
  db.execute(
    "INSERT INTO agents (id, name, token_hash, created_at) VALUES (:id, :name, :hash, '2026-11-07T00:00:00.000Z')",
    { id, name, hash: `hash-${id}` },
  );
};
