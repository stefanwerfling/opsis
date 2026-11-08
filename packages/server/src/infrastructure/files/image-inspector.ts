import { fileTypeFromBuffer } from 'file-type';
import sharp, { type Metadata } from 'sharp';
import {
  IMAGE_LIMITS,
  IMAGE_MIME_TYPES,
  OpsisError,
  type ImageInspector,
  type ImageMimeType,
  type InspectedImage,
} from '@opsis/core';

const SHARP_FORMAT_TO_MIME: Readonly<Record<string, ImageMimeType>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const isAllowedMime = (mime: string): mime is ImageMimeType =>
  (IMAGE_MIME_TYPES as readonly string[]).includes(mime);

/**
 * Determines the real image format from the content (magic bytes) – declared MIME types
 * and file names are never trusted – then fully decodes the image to reject truncated,
 * corrupt or oversized files (decompression bombs) before anything is stored.
 */
export class SharpImageInspector implements ImageInspector {
  async thumbnail(
    bytes: Uint8Array,
    maxEdge: number,
    crop?: { x: number; y: number; width: number; height: number },
  ): Promise<{ bytes: Uint8Array; width: number; height: number }> {
    let image = sharp(bytes, { limitInputPixels: IMAGE_LIMITS.maxPixels, animated: false });
    if (crop) {
      image = image.extract({
        left: Math.round(crop.x),
        top: Math.round(crop.y),
        width: Math.max(1, Math.round(crop.width)),
        height: Math.max(1, Math.round(crop.height)),
      });
    }
    const { data, info } = await image
      .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data), width: info.width, height: info.height };
  }

  async inspect(bytes: Uint8Array): Promise<InspectedImage> {
    if (bytes.byteLength > IMAGE_LIMITS.maxBytes) {
      throw new OpsisError('PAYLOAD_TOO_LARGE', `Image exceeds ${IMAGE_LIMITS.maxBytes} bytes`);
    }
    const detected = await fileTypeFromBuffer(bytes);
    if (!detected || !isAllowedMime(detected.mime)) {
      throw new OpsisError('UNSUPPORTED_MEDIA', 'Only PNG, JPEG and WebP images are supported', {
        detected: detected?.mime ?? null,
      });
    }

    const options = {
      limitInputPixels: IMAGE_LIMITS.maxPixels,
      failOn: 'truncated' as const,
      animated: false,
    };
    let metadata: Metadata;
    try {
      metadata = await sharp(bytes, options).metadata();
    } catch (error) {
      throw invalidImage(error);
    }
    const { width, height, format } = metadata;
    if (SHARP_FORMAT_TO_MIME[format] !== detected.mime) {
      throw new OpsisError('UNSUPPORTED_MEDIA', 'Image content does not match its detected format', {
        detected: detected.mime,
        decoded: format,
      });
    }
    if (
      width > IMAGE_LIMITS.maxEdgePx ||
      height > IMAGE_LIMITS.maxEdgePx ||
      width * height > IMAGE_LIMITS.maxPixels
    ) {
      throw new OpsisError('PAYLOAD_TOO_LARGE', 'Image dimensions exceed the allowed limits', {
        width,
        height,
        limits: IMAGE_LIMITS,
      });
    }
    try {
      // Full sequential decode (cheap downscaled output) proves the whole file is readable.
      await sharp(bytes, { ...options, sequentialRead: true })
        .resize(64, 64, { fit: 'inside' })
        .raw()
        .toBuffer();
    } catch (error) {
      throw invalidImage(error);
    }
    return { mimeType: detected.mime, width, height };
  }
}

const invalidImage = (error: unknown): OpsisError => {
  const message = error instanceof Error ? error.message : String(error);
  if (/pixel limit/i.test(message)) {
    return new OpsisError('PAYLOAD_TOO_LARGE', 'Image dimensions exceed the allowed limits');
  }
  return new OpsisError('VALIDATION', 'Image could not be decoded (corrupt or truncated)');
};
