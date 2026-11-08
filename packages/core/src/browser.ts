/**
 * Browser entry point: only dependency-free modules (no zod, no application layer).
 * Types of all other modules are imported from `@opsis/core` with `import type`.
 */
export * from './domain/completeness.js';
export * from './domain/draft.js';
export * from './domain/errors.js';
export * from './domain/geometry.js';
export * from './domain/ids.js';
export * from './domain/vocabulary.js';
