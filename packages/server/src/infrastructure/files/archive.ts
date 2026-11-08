import { OpsisError, type ArchiveCodec, type ArchiveEntry, type ArchiveLimits } from '@opsis/core';
import yauzl from 'yauzl';
import yazl from 'yazl';

/** Fixed entry time, so the same content always packs to the same bytes. */
const ENTRY_TIME = new Date('2000-01-01T00:00:00Z');

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;

const invalid = (message: string, details: Record<string, unknown> = {}): OpsisError =>
  new OpsisError('VALIDATION', `Invalid archive: ${message}`, details);

const readAll = async (stream: NodeJS.ReadableStream, limit: number): Promise<Uint8Array> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > limit) throw invalid('entry larger than declared or allowed');
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
};

/**
 * ZIP via yazl/yauzl (architecture 01). Unpacking is defensive: strict file names (no
 * absolute paths, no `..`, no backslashes), only regular files on an allow-list of paths,
 * no duplicates, no encryption, and limits on entry count, entry size and total size –
 * checked against the declared sizes first and enforced again while inflating.
 */
export class ZipArchiveCodec implements ArchiveCodec {
  pack(entries: readonly ArchiveEntry[]): Promise<Uint8Array> {
    const zip = new yazl.ZipFile();
    for (const entry of entries) {
      zip.addBuffer(Buffer.from(entry.bytes), entry.path, { mtime: ENTRY_TIME, mode: 0o100644 });
    }
    zip.end();
    return readAll(zip.outputStream, Number.MAX_SAFE_INTEGER);
  }

  async unpack(bytes: Uint8Array, limits: ArchiveLimits): Promise<ArchiveEntry[]> {
    let zip: yauzl.ZipFile;
    try {
      zip = await yauzl.fromBufferPromise(Buffer.from(bytes), {
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
        decodeStrings: true,
      });
    } catch (error) {
      throw invalid(error instanceof Error ? error.message : 'unreadable');
    }
    if (zip.entryCount > limits.maxEntries) {
      zip.close();
      throw invalid('too many entries', { entries: zip.entryCount, max: limits.maxEntries });
    }

    const entries: ArchiveEntry[] = [];
    const seen = new Set<string>();
    let total = 0;
    try {
      for (;;) {
        const entry = await new Promise<yauzl.Entry | null>((resolve, reject) => {
          zip.once('entry', resolve);
          zip.once('end', () => {
            resolve(null);
          });
          zip.once('error', reject);
          zip.readEntry();
        });
        zip.removeAllListeners('entry');
        zip.removeAllListeners('end');
        zip.removeAllListeners('error');
        if (entry === null) break;

        const path = entry.fileName;
        const type = (entry.externalFileAttributes >>> 16) & S_IFMT;
        if (path.endsWith('/') || (type !== 0 && type !== S_IFREG)) {
          throw invalid('only regular files are allowed', { path });
        }
        if (!limits.isAllowedPath(path)) throw invalid('unknown path', { path });
        if (seen.has(path)) throw invalid('duplicate path', { path });
        if (entry.isEncrypted()) throw invalid('encrypted entries are not supported', { path });
        if (entry.uncompressedSize > limits.maxEntryBytes) {
          throw invalid('entry too large', { path, max: limits.maxEntryBytes });
        }
        total += entry.uncompressedSize;
        if (total > limits.maxTotalBytes) throw invalid('archive too large', { max: limits.maxTotalBytes });
        seen.add(path);

        const stream = await zip.openReadStreamPromise(entry);
        entries.push({ path, bytes: await readAll(stream, entry.uncompressedSize) });
      }
    } catch (error) {
      if (error instanceof OpsisError) throw error;
      throw invalid(error instanceof Error ? error.message : 'unreadable');
    } finally {
      zip.close();
    }
    return entries;
  }
}
