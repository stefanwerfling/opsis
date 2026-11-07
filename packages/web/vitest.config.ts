import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { conditions: ['source'] },
  test: { name: 'web', include: ['src/**/*.test.ts'], environment: 'node' },
});
