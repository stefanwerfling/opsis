import sharp from 'sharp';
import { IMAGE_LIMITS, type Annotation, type ImageAnnotator } from '@opsis/core';

const MAX_LABEL_CHARS = 60;

/** XML-escapes user text; control characters (invalid in XML 1.0) are dropped. */
export const escapeXml = (value: string): string =>
  value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Code points (not UTF-16 units), so a cut never splits a surrogate pair. */
const codePoints = (value: string): string[] => Array.from(value);

const labelText = (name: string): string => {
  const single = name.replace(/\s+/g, ' ').trim();
  const chars = codePoints(single);
  return chars.length > MAX_LABEL_CHARS ? `${chars.slice(0, MAX_LABEL_CHARS - 1).join('')}…` : single;
};

/**
 * SVG overlay with a frame and a name tag per mark. Line width and font size scale with
 * the image, so the annotation stays legible on both small and very large screenshots.
 */
export const annotationSvg = (annotation: Annotation): string => {
  const { width, height } = annotation;
  const longEdge = Math.max(width, height);
  const stroke = Math.max(2, Math.round(longEdge / 600));
  const fontSize = Math.max(12, Math.round(longEdge / 90));
  const pad = Math.round(fontSize * 0.35);
  const tagHeight = fontSize + 2 * pad;

  const parts = annotation.marks.map((mark) => {
    const label = labelText(mark.name);
    // Width estimate for bold sans-serif (generous); a tag never extends beyond the image.
    const tagWidth = Math.min(Math.round(codePoints(label).length * fontSize * 0.7) + 2 * pad, width);
    const tagX = Math.min(mark.x, width - tagWidth);
    // Above the frame if there is room, otherwise inside its top edge.
    const tagY = mark.y >= tagHeight ? mark.y - tagHeight : mark.y;
    const inset = stroke / 2;
    return [
      `<rect x="${String(mark.x + inset)}" y="${String(mark.y + inset)}" width="${String(Math.max(mark.width - stroke, 0))}" height="${String(Math.max(mark.height - stroke, 0))}" fill="none" stroke="${mark.color}" stroke-width="${String(stroke)}"/>`,
      `<rect x="${String(tagX)}" y="${String(tagY)}" width="${String(tagWidth)}" height="${String(tagHeight)}" fill="${mark.color}"/>`,
      `<text x="${String(tagX + pad)}" y="${String(tagY + pad + fontSize * 0.8)}" fill="#ffffff">${escapeXml(label)}</text>`,
    ].join('');
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">`,
    `<g font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="${String(fontSize)}" font-weight="bold">`,
    ...parts,
    '</g></svg>',
  ].join('');
};

/** Composites the SVG overlay onto the original screenshot (architecture 05 §7). */
export class SharpImageAnnotator implements ImageAnnotator {
  async annotate(bytes: Uint8Array, annotation: Annotation): Promise<Uint8Array> {
    const image = sharp(bytes, { limitInputPixels: IMAGE_LIMITS.maxPixels, animated: false });
    const { width, height } = await image.metadata();
    if (width !== annotation.width || height !== annotation.height) {
      throw new Error('Screenshot dimensions do not match the specification');
    }
    const overlay = Buffer.from(annotationSvg(annotation));
    return new Uint8Array(
      await image
        .composite([{ input: overlay, top: 0, left: 0 }])
        .png()
        .toBuffer(),
    );
  }
}
