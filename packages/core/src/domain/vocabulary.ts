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

/** Component types from the requirements (section 7). */
export const COMPONENT_KINDS = ['component', 'container', 'visual_area', 'interactive', 'group'] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const RELATION_KINDS = ['controls', 'navigates_to', 'data_flow', 'depends_on', 'other'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** Where a specification value comes from (architecture 02 §3). */
export const SPEC_ORIGINS = ['user', 'screenshot_derived', 'auto_detected'] as const;
export type SpecOrigin = (typeof SPEC_ORIGINS)[number];

/**
 * Inspector groups and fields exactly as listed in the requirements (section 6, right
 * panel). "Name" and "Typ" of the group "Allgemein" are the component's `name`/`kind`.
 */
export const SPEC_GROUPS = {
  general: ['description', 'purpose', 'responsibility'],
  visual: ['colors', 'sizes', 'spacing', 'positioning', 'typography', 'borders', 'shadows', 'responsive'],
  functional: ['task', 'inputData', 'outputData', 'dataSources', 'actions', 'dependencies'],
  interaction: ['hover', 'click', 'focus', 'active', 'disabled', 'loading', 'error', 'success', 'keyboard'],
  layout: ['positioning', 'flexGrid', 'scrolling', 'overflow', 'sizing', 'parentRelation'],
  acceptance: [
    'expectedBehavior',
    'expectedLayout',
    'functionalRequirements',
    'errorConditions',
    'responsiveRequirements',
  ],
} as const;
export type SpecGroup = keyof typeof SPEC_GROUPS;
export const SPEC_GROUP_NAMES = Object.keys(SPEC_GROUPS) as SpecGroup[];
export type SpecField<G extends SpecGroup = SpecGroup> = (typeof SPEC_GROUPS)[G][number];

/** Limits for draft contents (kept generous; they protect the server, not the user). */
export const DRAFT_LIMITS = {
  maxComponents: 2000,
  maxRelations: 5000,
  maxNameLength: 200,
  maxTextLength: 10_000,
  maxListItems: 200,
  maxOperationsPerRequest: 500,
} as const;
