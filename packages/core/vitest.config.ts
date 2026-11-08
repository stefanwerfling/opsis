import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { conditions: ['@opsis/source'] },
  test: { name: 'core', include: ['src/**/*.test.ts'] },
});
