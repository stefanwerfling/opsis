import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { IMAGE_LIMITS, type ImageDiffer, type PixelDiffResult } from '@opsis/core';

/** Upper bound for the compared size: three RGBA buffers of this size stay below ~150 MB. */
export const MAX_DIFF_PIXELS = 12_000_000;

const decode = (bytes: Uint8Array) =>
  sharp(bytes, { limitInputPixels: IMAGE_LIMITS.maxPixels, animated: false });

/**
 * Pixel difference mask (architecture 05 §4). If the sizes differ, b is scaled to a's size
 * and the aspect ratios are reported. Very large screenshots are reduced first.
 */
export class PixelmatchImageDiffer implements ImageDiffer {
  async diff(a: Uint8Array, b: Uint8Array): Promise<PixelDiffResult> {
    const metaA = await decode(a).metadata();
    const metaB = await decode(b).metadata();
    const scale = Math.min(1, Math.sqrt(MAX_DIFF_PIXELS / (metaA.width * metaA.height)));
    const width = Math.max(1, Math.round(metaA.width * scale));
    const height = Math.max(1, Math.round(metaA.height * scale));
    const resized = metaA.width !== metaB.width || metaA.height !== metaB.height;

    const raw = (bytes: Uint8Array) =>
      decode(bytes).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
    const [pixelsA, pixelsB] = await Promise.all([raw(a), raw(b)]);
    const output = new Uint8Array(width * height * 4);
    const differentPixels = pixelmatch(pixelsA, pixelsB, output, width, height, {
      threshold: 0.1,
      alpha: 0.2,
      diffColor: [220, 38, 38],
      diffColorAlt: [37, 99, 235],
    });
    const png = await sharp(output, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    return {
      width,
      height,
      differentPixels,
      resized,
      aspectRatioA: metaA.width / metaA.height,
      aspectRatioB: metaB.width / metaB.height,
      png: new Uint8Array(png),
    };
  }
}
