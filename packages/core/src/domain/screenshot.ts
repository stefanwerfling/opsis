import { z } from 'zod';
import type { Timestamp } from './common.js';

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export const DEVICE_CATEGORIES = ['desktop', 'tablet', 'mobile', 'other'] as const;
export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];

export const SCREENSHOT_SOURCES = ['mcp', 'upload', 'import'] as const;
export type ScreenshotSource = (typeof SCREENSHOT_SOURCES)[number];

/** Upload limits (architecture 01 §6). Enforced before and while decoding. */
export const IMAGE_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxEdgePx: 16_384,
  // 40 MP covers full-page captures such as 2560×15000 while bounding decode memory.
  maxPixels: 40_000_000,
} as const;

export interface Screenshot {
  readonly id: string;
  readonly projectId: string;
  readonly uiViewId: string;
  readonly sessionId: string | null;
  readonly blobSha256: string;
  readonly mimeType: ImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly viewportWidth: number | null;
  readonly viewportHeight: number | null;
  readonly deviceCategory: DeviceCategory;
  readonly variantLabel: string | null;
  /** Running number per UI view – the "version number" of the screenshot. */
  readonly sequenceNo: number;
  readonly capturedAt: Timestamp | null;
  readonly source: ScreenshotSource;
  readonly submittedBy: string;
  readonly description: string;
  readonly createdAt: Timestamp;
}

const ViewportDimension = z.number().int().min(1).max(100_000);

export const ScreenshotMetadataSchema = z.strictObject({
  viewportWidth: ViewportDimension.optional(),
  viewportHeight: ViewportDimension.optional(),
  deviceCategory: z.enum(DEVICE_CATEGORIES).default('desktop'),
  variantLabel: z.string().trim().min(1).max(100).optional(),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
  description: z.string().max(10_000).default(''),
});
export type ScreenshotMetadata = z.input<typeof ScreenshotMetadataSchema>;
