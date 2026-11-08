import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Workspace packages expose their TypeScript sources under the "@opsis/source" condition,
    // so tests run against src without a prior build.
    conditions: ['@opsis/source'],
  },
  test: {
    projects: ['packages/*'],
  },
});
