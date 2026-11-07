/**
 * Enumerations and limits without any dependency. Kept separate from the zod schemas so the
 * browser bundle can import them (via `@opsis/core/browser`) without pulling in zod.
 */

export const PROMPT_LANGUAGES = ['en', 'de'] as const;
export type PromptLanguage = (typeof PROMPT_LANGUAGES)[number];

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
