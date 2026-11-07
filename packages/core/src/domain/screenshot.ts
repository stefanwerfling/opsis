import { z } from 'zod';
import type { Timestamp } from './common.js';

import {
  DEVICE_CATEGORIES,
  type DeviceCategory,
  type ImageMimeType,
  type ScreenshotSource,
} from './vocabulary.js';

export {
  DEVICE_CATEGORIES,
  IMAGE_LIMITS,
  IMAGE_MIME_TYPES,
  SCREENSHOT_SOURCES,
  type DeviceCategory,
  type ImageMimeType,
  type ScreenshotSource,
} from './vocabulary.js';

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
