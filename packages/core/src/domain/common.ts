import { z } from 'zod';

/** ISO-8601 UTC timestamp as stored and transported (e.g. `2026-11-07T18:00:00.000Z`). */
export type Timestamp = string;

const MAX_METADATA_BYTES = 64 * 1024;

/** Free-form JSON metadata, bounded in size so it cannot be abused as a blob store. */
export const MetadataSchema = z
  .record(z.string().min(1).max(100), z.json())
  .refine((value) => JSON.stringify(value).length <= MAX_METADATA_BYTES, {
    message: `metadata must not exceed ${MAX_METADATA_BYTES} bytes when serialized`,
  });

export type Metadata = z.infer<typeof MetadataSchema>;

export const NameSchema = z.string().trim().min(1).max(200);
export const DescriptionSchema = z.string().max(10_000);

const TRANSLITERATION: Readonly<Record<string, string>> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** Lowercase ASCII words joined by dashes (`Größe & Übersicht` → `groesse-uebersicht`); may be empty. */
export const asciiSlug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[äöüß]/g, (char) => TRANSLITERATION[char] ?? char)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
