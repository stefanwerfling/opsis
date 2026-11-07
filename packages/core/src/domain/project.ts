import { z } from 'zod';
import {
  asciiSlug,
  DescriptionSchema,
  MetadataSchema,
  NameSchema,
  type Metadata,
  type Timestamp,
} from './common.js';

export const PROMPT_LANGUAGES = ['en', 'de'] as const;
export type PromptLanguage = (typeof PROMPT_LANGUAGES)[number];

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ProjectSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(SLUG_PATTERN, 'lowercase letters, digits and single dashes');

export interface Project {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly promptLanguage: PromptLanguage;
  readonly metadata: Metadata;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt: Timestamp | null;
}

export const CreateProjectInputSchema = z.strictObject({
  name: NameSchema,
  slug: ProjectSlugSchema.optional(),
  description: DescriptionSchema.default(''),
  promptLanguage: z.enum(PROMPT_LANGUAGES).default('en'),
  metadata: MetadataSchema.default({}),
});
export type CreateProjectInput = z.input<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = z.strictObject({
  name: NameSchema.optional(),
  description: DescriptionSchema.optional(),
  promptLanguage: z.enum(PROMPT_LANGUAGES).optional(),
  metadata: MetadataSchema.optional(),
});
export type UpdateProjectInput = z.input<typeof UpdateProjectInputSchema>;

/** Derives a URL-safe slug from a project name (`Mein Projekt Ü` → `mein-projekt-ue`). */
export const slugify = (name: string): string => {
  const slug = asciiSlug(name).slice(0, 64).replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'project';
};
