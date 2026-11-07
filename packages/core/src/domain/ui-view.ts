import { z } from 'zod';
import { asciiSlug, DescriptionSchema, NameSchema, type Timestamp } from './common.js';
import { OpsisError } from './errors.js';

/**
 * UI-ID: the permanent identity of a logical UI view (`ui-dashboard-main`).
 * UI-Path: its current logical location (`/dashboard`). Both are distinct by design
 * (architecture principle 5): a path may change, the UI-ID never does.
 */
export const UI_ID_PATTERN = /^ui-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const UI_ID_MAX_LENGTH = 100;
export const UiIdSchema = z
  .string()
  .max(UI_ID_MAX_LENGTH)
  .regex(UI_ID_PATTERN, 'must look like "ui-dashboard-main" (prefix "ui-", lowercase, dashes)');

export const UI_PATH_MAX_LENGTH = 500;
const SEGMENT_PATTERN = /^(?::[A-Za-z_][A-Za-z0-9_]*|\*|[\p{L}\p{N}._~%@-]+)$/u;

/**
 * Normalizes a logical UI path: leading slash, no duplicate or trailing slashes,
 * no query/fragment, no dot segments. Route parameters (`:id`) and `*` are allowed.
 * Throws VALIDATION for anything that is not a plausible logical path.
 */
export const normalizeUiPath = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    throw new OpsisError('VALIDATION', 'UI path must start with "/"', { path: input });
  }
  if (/[?#\s\\]/.test(trimmed)) {
    throw new OpsisError('VALIDATION', 'UI path must not contain query, fragment, whitespace or backslash', {
      path: input,
    });
  }
  const segments = trimmed.split('/').filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || !SEGMENT_PATTERN.test(segment)) {
      throw new OpsisError('VALIDATION', `Invalid UI path segment "${segment}"`, { path: input });
    }
  }
  const normalized = `/${segments.join('/')}`;
  if (normalized.length > UI_PATH_MAX_LENGTH) {
    throw new OpsisError('VALIDATION', `UI path must not exceed ${UI_PATH_MAX_LENGTH} characters`);
  }
  return normalized;
};

export const UiPathSchema = z
  .string()
  .max(UI_PATH_MAX_LENGTH)
  .transform((value, ctx) => {
    try {
      return normalizeUiPath(value);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'invalid UI path' });
      return z.NEVER;
    }
  });

/** `/admin/users/:id` → `ui-admin-users-id`, `/` → `ui-root`. Collisions are resolved by the caller. */
export const deriveUiIdFromPath = (path: string): string => {
  const body = asciiSlug(normalizeUiPath(path));
  const candidate = `ui-${body.length > 0 ? body : 'root'}`;
  return candidate.slice(0, UI_ID_MAX_LENGTH - 4).replace(/-+$/g, '');
};

/** Appends `-2`, `-3`, … until `isTaken` returns false. */
export const uniqueUiId = (base: string, isTaken: (candidate: string) => boolean): string => {
  if (!isTaken(base)) return base;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!isTaken(candidate)) return candidate;
  }
  throw new OpsisError('CONFLICT', `No free UI-ID derivable from "${base}"`);
};

export interface UiView {
  readonly id: string;
  readonly projectId: string;
  readonly uiId: string;
  readonly path: string;
  readonly name: string;
  readonly description: string;
  readonly headVersionId: string | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface UiPathChange {
  readonly id: string;
  readonly uiViewId: string;
  readonly oldPath: string | null;
  readonly newPath: string;
  readonly changedBy: string;
  readonly reason: string;
  readonly changedAt: Timestamp;
}

export const CreateUiViewInputSchema = z.strictObject({
  uiId: UiIdSchema.optional(),
  path: UiPathSchema,
  name: NameSchema.optional(),
  description: DescriptionSchema.default(''),
});
export type CreateUiViewInput = z.input<typeof CreateUiViewInputSchema>;

export const ChangeUiPathInputSchema = z.strictObject({
  newPath: UiPathSchema,
  reason: z.string().max(2000).default(''),
});
export type ChangeUiPathInput = z.input<typeof ChangeUiPathInputSchema>;

/** Human-readable default name from a path: `/settings/profile` → `Settings / Profile`. */
export const defaultNameFromPath = (path: string): string => {
  const segments = normalizeUiPath(path)
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replace(/^:/, '').replace(/[-_]+/g, ' '))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1));
  return segments.length > 0 ? segments.join(' / ') : 'Root';
};
