import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { OpsisError } from '@opsis/core';
import { makeImage } from '../../testing/support.js';
import { FileBlobStore } from './blob-store.js';
import { SharpImageInspector } from './image-inspector.js';

const inspector = new SharpImageInspector();

const errorCode = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return 'NO_ERROR';
  } catch (error) {
    return error instanceof OpsisError ? error.code : `UNEXPECTED: ${String(error)}`;
  }
};

describe('SharpImageInspector', () => {
  it.each([
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ] as const)('accepts %s and reports real dimensions', async (format, mime) => {
    const result = await inspector.inspect(await makeImage(format, 390, 844));
    expect(result).toEqual({ mimeType: mime, width: 390, height: 844 });
  });

  it('determines the format from content, not from any declared type', async () => {
    const gif = new Uint8Array(
      await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
        .gif()
        .toBuffer(),
    );
    expect(await errorCode(inspector.inspect(gif))).toBe('UNSUPPORTED_MEDIA');
    expect(
      await errorCode(
        inspector.inspect(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
      ),
    ).toBe('UNSUPPORTED_MEDIA');
    expect(await errorCode(inspector.inspect(new TextEncoder().encode('just text')))).toBe(
      'UNSUPPORTED_MEDIA',
    );
  });

  it('rejects truncated images', async () => {
    const png = await makeImage('png', 800, 600, 3);
    // Noise ensures the compressed data spans enough bytes to be cut meaningfully.
    const noisy = new Uint8Array(
      await sharp(png)
        .composite([
          {
            input: Buffer.from(randomBytes(800 * 600 * 3)),
            raw: { width: 800, height: 600, channels: 3 },
            blend: 'difference',
          },
        ])
        .png()
        .toBuffer(),
    );
    expect(await errorCode(inspector.inspect(noisy.slice(0, Math.floor(noisy.length / 2))))).toBe(
      'VALIDATION',
    );
  });

  it('rejects images beyond the edge or pixel limits', async () => {
    expect(await errorCode(inspector.inspect(await makeImage('png', 16_385, 8)))).toBe('PAYLOAD_TOO_LARGE');
    expect(await errorCode(inspector.inspect(await makeImage('png', 8_000, 6_000)))).toBe(
      'PAYLOAD_TOO_LARGE',
    );
  });
});

const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += 65_536) {
    globalThis.crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65_536, length)));
  }
  return bytes;
};

describe('FileBlobStore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opsis-blobs-'));
  const store = new FileBlobStore(dir);
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores content-addressed and deduplicates', async () => {
    const bytes = await makeImage('png', 10, 10, 1);
    const first = await store.put(bytes, 'image/png');
    const second = await store.put(bytes, 'image/png');
    expect(second).toEqual(first);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(store.pathFor(first.sha256)).toBe(
      join(dir, first.sha256.slice(0, 2), first.sha256.slice(2, 4), first.sha256),
    );
    expect(await store.read(first.sha256)).toEqual(bytes);
  });

  it('never builds paths from anything but a hash', () => {
    expect(() => store.pathFor('../../etc/passwd')).toThrow();
    expect(() => store.pathFor('A'.repeat(64))).toThrow();
  });
});
