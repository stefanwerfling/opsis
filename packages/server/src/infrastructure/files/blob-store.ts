import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { BlobRecord, BlobStore, ImageMimeType } from '@opsis/core';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Content-addressed file storage: `<root>/ab/cd/<sha256>`.
 *
 * Paths are derived exclusively from the content hash, never from user input, which
 * rules out path traversal by construction. Writes go to a temp file, are fsynced and
 * then atomically renamed into place.
 */
export class FileBlobStore implements BlobStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  pathFor(sha256: string): string {
    if (!SHA256_PATTERN.test(sha256)) throw new Error('Invalid blob hash');
    return join(this.#root, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  }

  async put(bytes: Uint8Array, mimeType: ImageMimeType): Promise<BlobRecord> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const target = this.pathFor(sha256);
    const record: BlobRecord = { sha256, mimeType, byteSize: bytes.byteLength };
    if (await exists(target)) return record;

    const tmpDir = join(this.#root, 'tmp');
    await mkdir(tmpDir, { recursive: true });
    await mkdir(join(target, '..'), { recursive: true });
    const tmp = join(tmpDir, `${randomUUID()}.part`);
    const handle = await open(tmp, 'wx', 0o640);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(tmp, target);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
    return record;
  }

  async read(sha256: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(sha256)));
  }
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};
