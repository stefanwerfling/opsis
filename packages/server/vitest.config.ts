import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { conditions: ['source'] },
  test: { name: 'server', include: ['src/**/*.test.ts'] },
});
