/**
 * Browser entry point: only dependency-free modules (no zod, no application layer).
 * Types of all other modules are imported from `@opsis/core` with `import type`.
 */
export * from './domain/geometry.js';
export * from './domain/vocabulary.js';
